import { describe, it, expect } from "vitest";
import { AiGatewayGenerator, TemplateGenerator } from "./generators.js";
import type { GenerationContext } from "./types.js";
import { makeProfile } from "./testutils.js";

const ctx: GenerationContext = { trigger: "welcome", brandName: "CDP-US" };

describe("AiGatewayGenerator (offline)", () => {
  it("falls back to the template when url/key are missing", async () => {
    const gen = new AiGatewayGenerator({ model: "gpt-x" }); // no url/key
    const out = await gen.generate(makeProfile(), ctx);
    const expected = await new TemplateGenerator().generate(makeProfile(), ctx);
    expect(out).toEqual(expected);
  });

  it("uses the injected fetch and parses strict JSON", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify({
                  subject: "Hi from AI",
                  html: "<p>AI body</p>",
                }),
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;

    const gen = new AiGatewayGenerator({
      url: "https://gateway.test/v1",
      apiKey: "sk-test",
      model: "gpt-x",
      fetchImpl: fakeFetch,
    });
    const out = await gen.generate(makeProfile(), ctx);
    expect(out).toEqual({ subject: "Hi from AI", html: "<p>AI body</p>" });
  });

  it("strips ```json fences from the model output", async () => {
    const fenced =
      '```json\n{"subject":"Fenced","html":"<p>x</p>"}\n```';
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({ choices: [{ message: { content: fenced } }] }),
        { status: 200 },
      )) as unknown as typeof fetch;

    const gen = new AiGatewayGenerator({
      url: "https://gateway.test/v1",
      apiKey: "sk-test",
      model: "gpt-x",
      fetchImpl: fakeFetch,
    });
    const out = await gen.generate(makeProfile(), ctx);
    expect(out.subject).toBe("Fenced");
  });

  it("falls back on a non-2xx response", async () => {
    const fakeFetch = (async () =>
      new Response("nope", { status: 500 })) as unknown as typeof fetch;
    const gen = new AiGatewayGenerator({
      url: "https://gateway.test/v1",
      apiKey: "sk-test",
      model: "gpt-x",
      fetchImpl: fakeFetch,
    });
    const out = await gen.generate(makeProfile(), ctx);
    const expected = await new TemplateGenerator().generate(makeProfile(), ctx);
    expect(out).toEqual(expected);
  });

  it("falls back when the model returns unparseable content", async () => {
    const fakeFetch = (async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: "not json at all" } }],
        }),
        { status: 200 },
      )) as unknown as typeof fetch;
    const gen = new AiGatewayGenerator({
      url: "https://gateway.test/v1",
      apiKey: "sk-test",
      model: "gpt-x",
      fetchImpl: fakeFetch,
    });
    const out = await gen.generate(makeProfile(), ctx);
    const expected = await new TemplateGenerator().generate(makeProfile(), ctx);
    expect(out).toEqual(expected);
  });

  it("falls back when fetch throws (network error)", async () => {
    const fakeFetch = (async () => {
      throw new Error("network down");
    }) as unknown as typeof fetch;
    const gen = new AiGatewayGenerator({
      url: "https://gateway.test/v1",
      apiKey: "sk-test",
      model: "gpt-x",
      fetchImpl: fakeFetch,
    });
    const out = await gen.generate(makeProfile(), ctx);
    const expected = await new TemplateGenerator().generate(makeProfile(), ctx);
    expect(out).toEqual(expected);
  });
});
