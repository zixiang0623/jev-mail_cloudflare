const CATEGORIES = {
  notice: '通知(no-replyやシステム通知など、返信不要なもの)',
  payment: '支払い(請求書、領収書、カード利用明細など)',
  important: '重要(人間からの個別連絡、締切や対応が必要なもの)',
  other: 'その他(上記のいずれにも当てはまらないもの)',
};

function extractAnswer(response, key) {
  // AI Gateway経由だと { state, result: { model, answers, usage }, gatewayMetadata } の形で
  // 一段ラップされる。Gatewayを介さない場合は { model, answers, usage } が直接返る想定なので、両方に対応する。
  return response?.result?.answers?.[key] ?? response?.answers?.[key];
}

async function classifyOne(env, mail) {
  // Jevは「1つのstateに対して複数の異なる観点の質問をする」用途向けのモデルなので、
  // 配列にまとめて「i番目だけ見て」と指示するより、メール単体をstateにした方が確実。
  const state = JSON.stringify({
    subject: mail.subject,
    from: mail.from,
    snippet: mail.snippet,
  });

  const response = await env.AI.run('typesafe/jev', {
    state,
    questions: {
      category: {
        type: 'choice',
        instructions: 'このメール(件名・送信者・本文冒頭)を最も当てはまるカテゴリに分類して',
        criteria: CATEGORIES,
      },
    },
  });

  const answer = extractAnswer(response, 'category');

  return {
    ...mail,
    category: answer?.choice || 'other',
    confidence: answer?.confidence ?? null,
  };
}

async function classifyBatch(env, mails) {
  // Jevは1回70〜500ms程度と高速なので、バッチ内は並列に投げる。
  return Promise.all(mails.map((mail) => classifyOne(env, mail)));
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

const DEBUG_SAMPLES = [
  {
    label: '明らかに重要(人からの個別連絡)',
    subject: '至急ご確認ください:明日の会議について',
    from: '田中太郎 <tanaka@example.com>',
    snippet: '明日14時からの会議の件でご確認したいことがあります。資料を添付しましたのでご確認お願いします。',
  },
  {
    label: '明らかに支払い(請求書)',
    subject: 'ご請求書発行のお知らせ(2026年9月分)',
    from: 'AWS請求 <billing@aws.example.com>',
    snippet: '2026年9月分のご利用料金は12,340円です。お支払い期限は10月15日です。',
  },
  {
    label: '明らかに通知(システム通知)',
    subject: 'セキュリティ通知',
    from: 'Google <no-reply@accounts.google.com>',
    snippet: 'アカウントで新しいデバイスからのログインを検知しました。',
  },
];

async function handleDebug(env) {
  try {
    const results = await Promise.all(
      DEBUG_SAMPLES.map(async (sample) => {
        const response = await env.AI.run('typesafe/jev', {
          state: JSON.stringify({
            subject: sample.subject,
            from: sample.from,
            snippet: sample.snippet,
          }),
          questions: {
            category: {
              type: 'choice',
              instructions: 'このメール(件名・送信者・本文冒頭)を最も当てはまるカテゴリに分類して',
              criteria: CATEGORIES,
            },
          },
        });
        return {
          label: sample.label,
          extractedAnswer: extractAnswer(response, 'category'), // 実際にコードが読む値
          fullResponse: response, // 生のレスポンス全体(形の確認用)
        };
      })
    );
    return new Response(JSON.stringify({ results }, null, 2), {
      headers: { 'content-type': 'application/json' },
    });
  } catch (err) {
    return new Response(JSON.stringify({ error: String(err?.message || err), stack: err?.stack }, null, 2), {
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

    if (url.pathname === '/api/debug-classify') {
      return handleDebug(env);
    }

    // 静的アセット(フロントエンドのHTML)
    return env.ASSETS.fetch(request);
  },
};
