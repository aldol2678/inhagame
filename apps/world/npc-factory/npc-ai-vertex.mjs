// Production Vertex AI adapter. The caller supplies the project and a token provider
// (Cloud Run uses the metadata server identity); tests inject `fetcher`.

const VERTEX_ENDPOINT = 'https://aiplatform.googleapis.com';

export function createVertexNpcGenerator({ project, model = 'gemini-2.5-flash', fetcher = globalThis.fetch,
  tokenProvider, choiceMode = false } = {}) {
  if (!/^[a-z][a-z0-9-]{4,61}[a-z0-9]$/.test(project ?? '')) throw Error('EXPLICIT_GCP_PROJECT_REQUIRED');
  if (typeof tokenProvider !== 'function') throw Error('VERTEX_TOKEN_PROVIDER_REQUIRED');
  if (typeof fetcher !== 'function') throw Error('VERTEX_FETCHER_REQUIRED');
  return async (prompt, allowed) => {
    const token = await tokenProvider();
    if (!token || /\s/u.test(token)) throw Error('GCLOUD_TOKEN_UNAVAILABLE');
    const response = await fetcher(`${VERTEX_ENDPOINT}/v1/projects/${project}/locations/global/publishers/google/models/${model}:generateContent`, {
      method: 'POST', signal: AbortSignal.timeout(15000),
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.65, maxOutputTokens: 200, thinkingConfig: { thinkingBudget: 0 },
          responseMimeType: 'application/json', responseSchema: choiceMode
            ? { type: 'OBJECT', properties: { choice: { type: 'STRING', enum: allowed } }, required: ['choice'] }
            : { type: 'OBJECT', properties: {
              line: { type: 'STRING' }, action: { type: 'STRING', enum: allowed }
            }, required: ['line', 'action'] }
        }
      })
    });
    if (!response.ok) throw Error(`VERTEX_HTTP_${response.status}`);
    const data = await response.json();
    if (data.candidates?.[0]?.finishReason !== 'STOP') throw Error('VERTEX_INCOMPLETE');
    const text = data.candidates[0].content?.parts?.filter(part => typeof part.text === 'string')
      .map(part => part.text).join('');
    const usage = data.usageMetadata;
    if (usage) console.log(`NPC AI pilot usage: input=${usage.promptTokenCount ?? '?'} output=${usage.candidatesTokenCount ?? '?'} total=${usage.totalTokenCount ?? '?'}`);
    return JSON.parse(text);
  };
}
