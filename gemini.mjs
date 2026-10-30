// Provider messages may echo input. Persist only a bounded diagnostic category.
export function geminiFailure(status,body){
  const message=String(body?.error?.message??'');
  const reason=/API key not valid|API_KEY_INVALID/i.test(message)?'KEY_INVALID':
    /too many states|too much branching|schema.*complex|constraint.*states/i.test(message)?'SCHEMA_COMPLEXITY':
    /schema|generation_config|generationConfig/i.test(message)?'SCHEMA_INVALID':
    status===429?'RATE_LIMITED':status===402?'BILLING_REQUIRED':status===403?'ACCESS_DENIED':'REQUEST_FAILED';
  const error=Error(`Gemini HTTP ${status}; reservation retained`);
  error.code=reason==='REQUEST_FAILED'?`GEMINI_HTTP_${status}`:`GEMINI_${reason}`;error.diagnostic={httpStatus:status,reason};return error;
}
export class Gemini {
  constructor(env = process.env, fetcher = fetch) {
    this.key = env.GEMINI_API_KEY;
    this.model = env.GEMINI_MODEL;
    this.inputPrice = Number(env.GEMINI_INPUT_USD_PER_MILLION);
    this.outputPrice = Number(env.GEMINI_OUTPUT_USD_PER_MILLION);
    if (!this.key || !/^[a-zA-Z0-9._-]+$/.test(this.model ?? '') ||
        ![this.inputPrice, this.outputPrice].every(n => Number.isFinite(n) && n > 0))
      throw Error('Configure Gemini key, model and current token prices in server environment variables');
    this.fetcher = fetcher;
  }
  quote(system, prompt) {
    // Conservative UTF-8 byte bound for text input; output includes thinking.
    // This is a configured tariff estimate, not a provider billing guarantee.
    return Math.ceil((Buffer.byteLength(system + prompt) + 2048) * this.inputPrice + 8192 * this.outputPrice);
  }
  async generate(system, prompt, media=null, responseJsonSchema=null,references=[]) {
    const response = await this.fetcher(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.key },
        signal: AbortSignal.timeout(90_000),
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: system }] },
          contents: [{ role: 'user', parts: [{ text: prompt }, ...(media?[{inlineData:{mimeType:media.mime,data:Buffer.from(media.bytes).toString('base64')}}]:[]),...references.flatMap((a,i)=>[{text:'REFERENCE '+(i+1)+' (not the candidate)'},{inlineData:{mimeType:a.mime,data:Buffer.from(a.bytes).toString('base64')}}])] }],
          generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 8192, ...(responseJsonSchema?{responseJsonSchema}:{}) },
        }),
      });
    if (!response.ok) throw geminiFailure(response.status,await response.json().catch(()=>null));
    const body = await response.json();
    const usage = body.usageMetadata;
    if (!usage || !Number.isSafeInteger(usage.promptTokenCount) ||
        !Number.isSafeInteger(usage.candidatesTokenCount)) throw Error('Missing billing usage');
    const thoughts = usage.thoughtsTokenCount ?? 0;
    if (!Number.isSafeInteger(thoughts) || thoughts < 0 || usage.promptTokenCount < 0 || usage.candidatesTokenCount < 0)
      throw Error('Invalid billing usage');
    const candidate = body.candidates?.[0];
    if (candidate?.finishReason !== 'STOP') throw Error('Incomplete generation');
    return {
      value: JSON.parse(candidate.content.parts.filter(p => !p.thought).map(p => p.text ?? '').join('')),
      costMicrodollars: Math.ceil(usage.promptTokenCount * this.inputPrice +
        (usage.candidatesTokenCount + thoughts) * this.outputPrice),
    };
  }
}
