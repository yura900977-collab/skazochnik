// Cloudflare Worker — Сказочник API
// Secrets required:
//   OPENROUTER_API_KEY  — for /generate and /riddles (text generation)
//   OPENAI_API_KEY      — for /image (DALL-E 3) and /tts (OpenAI TTS)

// OpenAI TTS limits
const TTS_MAX_CHARS = 4000; // OpenAI TTS API maximum input length
const TTS_DEFAULT_VOICE = 'nova'; // soft feminine voice, ideal for fairy tales
const TTS_SPEED = 0.9; // slightly slower for children

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export default {
  async fetch(request, env) {
    // ── CORS preflight ───────────────────────────────────────────────────
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders });
    }

    const url = new URL(request.url);
    let body = {};
    if (request.method === 'POST') {
      try { body = await request.json(); } catch {}
    }

    // ─── ENDPOINT: /generate ────────────────────────────────────────────
    if (url.pathname === '/generate') {
      if (!env.OPENROUTER_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'OpenRouter API ключ не настроен' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { name, age, gender, interests, mood, length, type, character } = body;

      const moodMap = { night: 'спокойная, убаюкивающая', fun: 'весёлая, приключенческая', learn: 'обучающая, познавательная' };
      const lengthMap = { short: 'СТРОГО 480–560 слов, не больше и не меньше', long: 'СТРОГО 1040–1200 слов, не больше и не меньше' };
      const maxTokensMap = { short: 1200, long: 2500 };
      const genderWord = gender === 'girl' ? 'девочка' : 'мальчик';

      let prompt;
      if (type === 'letter') {
        prompt = `Напиши доброе детское письмо от ${character} ребёнку по имени ${name} (${age} лет, интересы: ${interests || 'разные'}). Письмо должно быть тёплым, волшебным, поддерживающим. Около 200–350 слов. Без заголовка.`;
      } else {
        prompt = `Напиши уникальную детскую сказку на русском языке. Главный герой — ${genderWord} по имени ${name}, ${age} лет, увлекается: ${interests || 'приключения'}. Настроение: ${moodMap[mood] || 'весёлая'}. Длина сказки: ${lengthMap[length] || lengthMap.short}. Это требование обязательно. Формат: первая строка — заголовок в формате "# Название сказки", затем текст с абзацами. Сказка должна быть доброй, безопасной для детей, с моралью.`;
      }

      const openRouterRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://skazochnik.ru',
          'X-Title': 'Сказочник',
        },
        body: JSON.stringify({
          model: 'openai/gpt-4o-mini',
          stream: true,
          max_tokens: maxTokensMap[length] || 1200,
          messages: [{ role: 'user', content: prompt }],
        }),
      });

      if (!openRouterRes.ok) {
        const errText = await openRouterRes.text();
        return new Response(
          JSON.stringify({ error: 'OpenRouter error: ' + errText }),
          { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { readable, writable } = new TransformStream();
      const writer = writable.getWriter();
      const encoder = new TextEncoder();

      (async () => {
        const reader = openRouterRes.body.getReader();
        const decoder = new TextDecoder();
        let buf = '';
        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split('\n');
            buf = lines.pop() || '';
            for (const line of lines) {
              const trimmed = line.trim();
              if (!trimmed.startsWith('data: ')) continue;
              const data = trimmed.slice(6);
              if (data === '[DONE]') {
                await writer.write(encoder.encode('data: [DONE]\n\n'));
                continue;
              }
              try {
                const parsed = JSON.parse(data);
                const text = parsed.choices?.[0]?.delta?.content;
                if (text) {
                  await writer.write(encoder.encode(`data: ${JSON.stringify({ text })}\n\n`));
                }
              } catch {}
            }
          }
        } finally {
          await writer.close();
        }
      })();

      return new Response(readable, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
      });
    }

    // ─── ENDPOINT: /image ────────────────────────────────────────────────
    if (url.pathname === '/image') {
      if (!env.OPENAI_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'OpenAI API ключ не настроен' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { title, interests, mood, name } = body;
      if (!title) {
        return new Response(
          JSON.stringify({ error: 'Название сказки обязательно' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const moodStyle = mood === 'night'
        ? 'soft dreamy night atmosphere, moonlight, stars, calm and peaceful'
        : mood === 'learn'
        ? 'bright educational colorful illustration, clear simple shapes'
        : 'bright cheerful adventure scene, vibrant colors, magical';

      const prompt = `Children's book illustration for a fairy tale titled "${title}". A cute child character named ${name || 'a child'} in a magical world. Interests: ${interests || 'magic and adventure'}. Style: ${moodStyle}. Watercolor and digital art style, soft pastel colors, friendly characters, no text, no letters, safe for children, whimsical fairy tale atmosphere, high quality illustration.`;

      try {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: prompt,
            n: 1,
            size: '1024x1024',
            quality: 'standard',
            style: 'vivid',
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          return new Response(
            JSON.stringify({ error: 'OpenAI image error: ' + errText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const data = await response.json();
        const imageUrl = data.data?.[0]?.url;

        return new Response(
          JSON.stringify({ url: imageUrl }),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Image generation error: ' + e.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ─── ENDPOINT: /tts ──────────────────────────────────────────────────
    if (url.pathname === '/tts') {
      if (!env.OPENAI_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'OpenAI API ключ не настроен' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { text, voice } = body;
      if (!text) {
        return new Response(
          JSON.stringify({ error: 'Текст обязателен' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Обрезаем текст до 4000 символов (лимит TTS)
      const truncatedText = text.slice(0, TTS_MAX_CHARS);

      try {
        const response = await fetch('https://api.openai.com/v1/audio/speech', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'tts-1',
            input: truncatedText,
            voice: voice || TTS_DEFAULT_VOICE,
            speed: TTS_SPEED,
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          return new Response(
            JSON.stringify({ error: 'OpenAI TTS error: ' + errText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Возвращаем аудио напрямую
        const audioBuffer = await response.arrayBuffer();
        return new Response(audioBuffer, {
          status: 200,
          headers: {
            ...corsHeaders,
            'Content-Type': 'audio/mpeg',
            'Cache-Control': 'public, max-age=3600',
          },
        });
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'TTS error: ' + e.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ─── ENDPOINT: /riddles ──────────────────────────────────────────────
    if (url.pathname === '/riddles') {
      if (!env.OPENROUTER_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'OpenRouter API ключ не настроен' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { name, age, gender, interests, count = 5, shownIds = [] } = body;
      const genderWord = gender === 'girl' ? 'девочки' : 'мальчика';

      const prompt = `Придумай ${count} детских загадок на русском языке для ${genderWord} по имени ${name} (${age} лет), которому интересно: ${interests || 'животные, природа'}. Загадки должны быть простыми, весёлыми, подходящими для возраста. Верни ТОЛЬКО валидный JSON без markdown-обёртки: { "riddles": [ { "id": "уникальная строка", "question": "текст загадки", "answer": "ответ", "hint": "подсказка" } ] }. Не повторяй загадки с id: ${JSON.stringify(shownIds)}.`;

      try {
        const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.OPENROUTER_API_KEY}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://skazochnik.ru',
            'X-Title': 'Сказочник',
          },
          body: JSON.stringify({
            model: 'openai/gpt-4o-mini',
            messages: [{ role: 'user', content: prompt }],
          }),
        });

        if (!res.ok) {
          const errText = await res.text();
          return new Response(
            JSON.stringify({ error: 'OpenRouter error: ' + errText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const data = await res.json();
        const content = data.choices?.[0]?.message?.content || '';
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        const parsed = JSON.parse(jsonMatch ? jsonMatch[0] : content);

        return new Response(
          JSON.stringify(parsed),
          { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Riddles error: ' + e.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // ─── ENDPOINT: /coloring ─────────────────────────────────────────────
    if (url.pathname === '/coloring') {
      if (!env.OPENAI_API_KEY) {
        return new Response(
          JSON.stringify({ error: 'OpenAI API ключ не настроен' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const { name, age, interests, gender } = body;

      const prompt = `Black and white coloring page for children, thick clear outlines, no fill, white background, simple cute illustration featuring a child named ${name || 'a child'} (${age || '5'} years old) with interests: ${interests || 'animals and adventure'}. Printable coloring book style, no shading, no gray areas, bold outlines only, suitable for kids to color in.`;

      try {
        const response = await fetch('https://api.openai.com/v1/images/generations', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${env.OPENAI_API_KEY}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'dall-e-3',
            prompt: prompt,
            n: 1,
            size: '1024x1024',
            quality: 'standard',
            style: 'natural',
          }),
        });

        if (!response.ok) {
          const errText = await response.text();
          return new Response(
            JSON.stringify({ error: 'OpenAI image error: ' + errText }),
            { status: 502, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        const data = await response.json();
        const imageUrl = data.data?.[0]?.url;
        return new Response(JSON.stringify({ url: imageUrl }), {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      } catch (e) {
        return new Response(
          JSON.stringify({ error: 'Coloring error: ' + e.message }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    return new Response('Not Found', { status: 404, headers: corsHeaders });
  },
};
