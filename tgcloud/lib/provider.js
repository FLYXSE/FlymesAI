// Which company actually serves a model id.
//
// The gateway (OpenAI-compatible) does not report a provider, so we guess it
// from the model id prefix and fall back to the gateway itself (Elisart).
const PREFIXES = [
  [/^grok/i, 'xAI'],
  [/^qwen/i, 'Alibaba'],
  [/^deepseek/i, 'DeepSeek'],
  [/^(glm|chatglm)/i, 'Zhipu AI'],
  [/^(kimi|moonshot)/i, 'Moonshot AI'],
  [/^(gpt|chatgpt|o[1-4](-|$))/i, 'OpenAI'],
  [/^claude/i, 'Anthropic'],
  [/^(gemini|gemma)/i, 'Google'],
  [/^llama/i, 'Meta'],
  [/^(mistral|mixtral|codestral)/i, 'Mistral AI'],
  [/^command/i, 'Cohere'],
  [/^sonar/i, 'Perplexity'],
  [/^phi/i, 'Microsoft'],
  [/^(ernie|wenxin)/i, 'Baidu'],
  [/^yi(-|$)/i, '01.AI'],
];

export function providerFor(modelId) {
  const id = String(modelId ?? '').trim();
  if (!id) return '';

  const match = PREFIXES.find(([re]) => re.test(id));
  return match ? match[1] : 'Elisart';
}
