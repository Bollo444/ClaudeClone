/**
 * OpenAI-compatible provider wrapper.
 *
 * NVIDIA uses the OpenAI API format. This wraps the OpenAI SDK to produce
 * Anthropic-compatible stream events so ClaudeClone's main loop works unchanged.
 */
import OpenAI from 'openai'

interface AnthropicMessageParam {
  role: 'user' | 'assistant'
  content: string | Array<{
    type: string
    text?: string
    [key: string]: unknown
  }>
}

interface AnthropicSystemBlock {
  type: 'text'
  text: string
}

interface AnthropicResponse {
  id: string
  type: 'message'
  role: string
  content: Array<{ type: string; text?: string }>
  model: string
  stop_reason: string | null
  stop_sequence: string | null
  usage: {
    input_tokens: number
    output_tokens: number
    cache_creation_input_tokens?: number
    cache_read_input_tokens?: number
  }
  _request_id?: string | null
}

type BetaRawMessageStreamEvent =
  | { type: 'message_start'; message: { id: string; type: string; role: string; content: Array<{type: string; text?: string}>; model: string; stop_reason: string | null; stop_sequence: string | null; usage: { input_tokens: number; output_tokens: number; cache_creation_input_tokens?: number; cache_read_input_tokens?: number } } }
  | { type: 'content_block_start'; index: number; content_block: { type: string; text: string; id?: string } }
  | { type: 'content_block_delta'; index: number; delta: { type: string; text: string } }
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_delta'; delta: { stop_reason: string | null; stop_sequence: string | null }; usage: { output_tokens: number } }
  | { type: 'message_stop' }

interface StreamWithResponse {
  data: StreamController
  response: Response
  request_id: string | null
}

function toOpenAIMessages(
  messages: AnthropicMessageParam[],
  system?: AnthropicSystemBlock[] | string,
): OpenAI.ChatCompletionMessageParam[] {
  const out: OpenAI.ChatCompletionMessageParam[] = []
  if (system) {
    const text = typeof system === 'string' ? system : system.map(b => b.text).join('\n')
    if (text) out.push({ role: 'system', content: text })
  }
  for (const msg of messages) {
    const content = typeof msg.content === 'string'
      ? msg.content
      : msg.content.filter((b: any) => b.type === 'text').map((b: any) => b.text || '').join('\n')
    out.push({ role: msg.role as 'user' | 'assistant', content })
  }
  return out
}

function fromOpenAIResponse(resp: OpenAI.Chat.Completions.ChatCompletion): AnthropicResponse {
  const text = resp.choices[0]?.message?.content || ''
  return {
    id: resp.id,
    type: 'message',
    role: 'assistant',
    content: text ? [{ type: 'text', text }] : [],
    model: resp.model,
    stop_reason: resp.choices[0]?.finish_reason
      ? resp.choices[0].finish_reason === 'stop' ? 'end_turn' : resp.choices[0].finish_reason
      : null,
    stop_sequence: null,
    usage: {
      input_tokens: resp.usage?.prompt_tokens ?? 0,
      output_tokens: resp.usage?.completion_tokens ?? 0,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    _request_id: resp.id,
  }
}

function mockResponse(): Response {
  return { ok: true, status: 200, headers: new Map() } as unknown as Response
}

/**
 * StreamController that matches the Anthropic SDK's Stream class behavior.
 * Returns synchronously from create() and lazily starts the API call
 * when first iterated (matching how the real SDK works).
 */
export class StreamController {
  // Must exist so `!('controller' in e.value)` in claude.ts skips yielding this
  controller: ReadableStreamDefaultController<BetaRawMessageStreamEvent> | null = null

  #events: BetaRawMessageStreamEvent[] | null = null
  #response: Response
  #requestId: string | null
  #index = 0
  #promise: Promise<void> | null = null

  constructor(
    private params: any,
    private msgs: OpenAI.ChatCompletionMessageParam[],
    private opts: { signal?: AbortSignal } | undefined,
    private client: OpenAI,
  ) {
    this.#response = mockResponse()
    this.#requestId = null
  }

  async #ensure(): Promise<void> {
    if (this.#promise) return this.#promise
    this.#promise = this._collect()
    await this.#promise
  }

  private async _collect(): Promise<void> {
    console.error('[Compat] Starting API call for stream...')
    const openaiStream = await this.client.chat.completions.create({
      model: this.params.model,
      messages: this.msgs,
      max_tokens: this.params.max_tokens ?? 4096,
      temperature: this.params.temperature,
      stream: true,
      ...(this.params.stop_sequences && { stop: this.params.stop_sequences }),
    }, { signal: this.opts?.signal })

    console.error('[Compat] OpenAI stream obtained, collecting events...')

    const events: BetaRawMessageStreamEvent[] = []
    let msgId = 'msg_openai'
    let started = false
    let totalOutputTokens = 0

    for await (const chunk of openaiStream as AsyncIterable<OpenAI.Chat.Completions.ChatCompletionChunk>) {
      if (!started) {
        msgId = chunk.id || msgId
        started = true
        events.push({
          type: 'message_start',
          message: {
            id: msgId,
            type: 'message',
            role: 'assistant',
            content: [],
            model: chunk.model || this.params.model,
            stop_reason: null,
            stop_sequence: null,
            usage: {
              input_tokens: chunk.usage?.prompt_tokens ?? 0,
              output_tokens: 0,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
            },
          },
        })
        events.push({
          type: 'content_block_start',
          index: 0,
          content_block: { type: 'text', text: '' },
        })
      }

      const delta = chunk.choices[0]?.delta
      if (delta?.content) {
        events.push({
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: delta.content },
        })
      }

      if (chunk.choices[0]?.finish_reason) {
        totalOutputTokens += 1
      }
    }

    if (started) {
      events.push({ type: 'content_block_stop', index: 0 })
      events.push({
        type: 'message_delta',
        delta: { stop_reason: 'end_turn', stop_sequence: null },
        usage: { output_tokens: totalOutputTokens },
      })
      events.push({ type: 'message_stop' })
    }

    console.error('[Compat] Collected ' + events.length + ' events')
    this.#events = events
  }

  /**
   * Returns events one by one. When exhausted, returns { done: true, value: this }.
   * The `controller` property ensures it's skipped by the yield check in claude.ts.
   */
  async next(): Promise<IteratorResult<BetaRawMessageStreamEvent>> {
    await this.#ensure()
    if (!this.#events) {
      return { value: this as unknown as BetaRawMessageStreamEvent, done: true }
    }
    if (this.#index < this.#events.length) {
      return { value: this.#events[this.#index++]!, done: false }
    }
    return { value: this as unknown as BetaRawMessageStreamEvent, done: true }
  }

  [Symbol.asyncIterator](): AsyncIterator<BetaRawMessageStreamEvent> {
    return this
  }

  withResponse(): StreamWithResponse {
    return {
      data: this,
      response: this.#response,
      request_id: this.#requestId,
    }
  }
}

export class AnthropicOpenAICompat {
  private client: OpenAI

  constructor(opts: { apiKey?: string; baseURL?: string }) {
    this.client = new OpenAI({ apiKey: opts.apiKey || '', baseURL: opts.baseURL })
  }

  beta = {
    messages: {
      create: (
        params: {
          model: string
          max_tokens?: number
          system?: AnthropicSystemBlock[]
          messages: AnthropicMessageParam[]
          temperature?: number
          stop_sequences?: string[]
          stream?: boolean
          [key: string]: unknown
        },
        opts?: { signal?: AbortSignal },
      ): StreamController | Promise<AnthropicResponse> => {
        const msgs = toOpenAIMessages(params.messages, params.system)

        if (params.stream) {
          console.error('[Compat] STREAM model=' + params.model + ' msgs=' + msgs.length)
          // Return synchronously so .withResponse() exists immediately
          return new StreamController(params, msgs, opts, this.client)
        }

        return this._handleNonStreaming(params, msgs, opts)
      },
    },
  }

  private async _handleNonStreaming(
    params: any,
    msgs: OpenAI.ChatCompletionMessageParam[],
    opts?: { signal?: AbortSignal },
  ): Promise<AnthropicResponse> {
    console.error('[Compat] NON-STREAM model=' + params.model)
    const completion = await this.client.chat.completions.create({
      model: params.model,
      messages: msgs,
      max_tokens: params.max_tokens ?? 4096,
      temperature: params.temperature,
      ...(params.stop_sequences && { stop: params.stop_sequences }),
    }, { signal: opts?.signal })

    console.error('[Compat] Response id=' + completion.id)
    return fromOpenAIResponse(completion)
  }
}

export { AnthropicOpenAICompat as Anthropic }
