export async function checkHealth(signal: AbortSignal): Promise<void> {
 const response = await fetch('/api/health', {signal: AbortSignal.any([signal, AbortSignal.timeout(5000)])});
 if (!response.ok || (await response.json()).status !== 'ok') throw new Error('API unavailable');
}
