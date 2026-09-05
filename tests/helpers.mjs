export const VALID_STORYBOARD = {
  audio: {
    music: { enabled: true, mood: "premium cinematic saas" },
    voiceover: {
      enabled: true,
      script: "short spoken film",
      tone: "confident, warm, premium",
      pace: "natural",
    },
  },
  scenes: [
    {
      type: "logo-intro",
      duration: 48,
      role: "hook",
      props: { productName: "Tables" },
      voiceover: { enabled: true, script: "Find prospects faster." },
    },
    {
      type: "text-reveal",
      duration: 60,
      role: "friction",
      props: {
        lines: ["Scattered tools stall every deal."],
      },
      voiceover: {
        enabled: true,
        script: "Stop hopping between workflows.",
      },
    },
    {
      type: "text-reveal",
      duration: 120,
      role: "benefit",
      props: {
        lines: ["One intelligent workspace."],
      },
      voiceover: {
        enabled: true,
        script: "Connect the right people in one place.",
      },
    },
    {
      type: "cta-outro",
      duration: 48,
      role: "cta",
      props: { headline: "Discover. Connect.", sub: "Work from one workspace." },
      voiceover: { enabled: true, script: "Start connecting today." },
    },
  ],
};

export function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return typeof body === "string" ? body : JSON.stringify(body);
    },
  };
}

export function ollamaChatResponse(content) {
  return jsonResponse(200, {
    model: "qwen2.5-coder:3b",
    message: {
      role: "assistant",
      content,
    },
    done: true,
  });
}

export function mockFetch(handler) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(url, init, calls);
  };
  return { fetchImpl, calls };
}
