require("dotenv").config();
const axios = require("axios");

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;

/*
뉴스 텍스트 → GPT 요약
*/
async function summarizeNews(text) {
    if (!OPENAI_API_KEY) {
        throw new Error("OPENAI_API_KEY가 .env에 없습니다.");
    }

    const prompt = `
너는 경제 뉴스 요약 봇이다.

아래 뉴스 목록을 읽고
오늘 핵심 경제 이슈를 한국어로 3~5줄로 요약해라.

규칙
- 반드시 3~5줄
- 중복 내용은 합쳐라
- 광고 / 가입 / 홍보 문구는 제외
- 같은 의미 문장은 하나로 합쳐라
- 문장 앞에는 1) 2) 3) 번호를 붙여라

뉴스 목록:
${text}
`;

    const res = await axios.post(
        "https://api.openai.com/v1/responses",
        {
            model: "gpt-4.1-mini",
            input: prompt
        },
        {
            headers: {
                Authorization: `Bearer ${OPENAI_API_KEY}`,
                "Content-Type": "application/json"
            }
        }
    );

    const summary = extractText(res.data);

    if (!summary) {
        throw new Error("OpenAI 요약 결과가 비어 있습니다.");
    }

    return dedupeLines(summary);
}

/*
OpenAI 응답에서 텍스트 추출
*/
function extractText(data) {
    if (!data.output) return "";

    for (const item of data.output) {
        if (item.content) {
            for (const c of item.content) {
                if (c.text) return c.text;
            }
        }
    }

    return "";
}

/*
요약 결과 중복 줄 제거
*/
function dedupeLines(text) {
    const lines = text
        .split("\n")
        .map(l => l.trim())
        .filter(Boolean);

    const seen = new Set();
    const result = [];

    for (const line of lines) {
        const key = line
            .replace(/\s+/g, " ")
            .replace(/[^\p{L}\p{N}\s]/gu, "");

        if (seen.has(key)) continue;

        seen.add(key);
        result.push(line);
    }

    return result.slice(0, 5).join("\n");
}

module.exports = { summarizeNews };