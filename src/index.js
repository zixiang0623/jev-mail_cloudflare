const CATEGORIES = {
  notice: '通知(no-replyやシステム通知など、返信不要なもの)',
  payment: '支払い(請求書、領収書、カード利用明細など)',
  important: '重要(人間からの個別連絡、締切や対応が必要なもの)',
  other: 'その他(上記のいずれにも当てはまらないもの)',
};

function buildQuestions(mails) {
  const questions = {};
  mails.forEach((mail, i) => {
    questions[`cat_${i}`] = {
      type: 'choice',
      instructions: `state配列のインデックス${i}のメール(件名・送信者・本文冒頭)を分類して`,
      criteria: CATEGORIES,
    };
  });
  return questions;
}

async function classifyBatch(env, mails) {
  // Jevは1リクエスト = 1state + 複数questionsを並列評価する仕組みなので、
  // バッチ内の複数メールは「配列state + メールごとに1問」の形でまとめて1回のリクエストに載せる。
  const state = JSON.stringify(
    mails.map((m, i) => ({
      index: i,
      subject: m.subject,
      from: m.from,
      snippet: m.snippet,
    }))
  );

  const result = await env.AI.run('typesafe/jev', {
    state,
    questions: buildQuestions(mails),
  });

  return mails.map((mail, i) => ({
    ...mail,
    category: result.answers?.[`cat_${i}`]?.choice || 'other',
    confidence: result.answers?.[`cat_${i}`]?.confidence ?? null,
  }));
}

async function handleClassify(request, env) {
  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: 'invalid JSON body' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  const mails = Array.isArray(body?.mails) ? body.mails : null;
  if (!mails || mails.length === 0) {
    return new Response(JSON.stringify({ error: 'mails配列が必要です' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }
  if (mails.length > 10) {
    return new Response(JSON.stringify({ error: '1リクエストあたり最大10件までです' }), {
      status: 400,
      headers: { 'content-type': 'application/json' },
    });
  }

  try {
    const classified = await classifyBatch(env, mails);
    return new Response(JSON.stringify({ results: classified }), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err) }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === '/api/classify' && request.method === 'POST') {
      return handleClassify(request, env);
    }

    // 静的アセット(フロントエンドのHTML)
    return env.ASSETS.fetch(request);
  },
};
