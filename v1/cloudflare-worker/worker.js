/**
 * Cloudflare Worker: Minecraft Profile Views Chat Badge
 * 
 * Flow:
 * 1. Client / GitHub Camo requests worker URL (e.g. /chat.svg?username=mertcetne)
 * 2. Worker fetches count from komarev.com
 * 3. Worker extracts view count and builds pixel-perfect Minecraft Chat SVG
 * 4. Returns SVG with no-cache headers
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // Query parameters with defaults
    const username = url.searchParams.get('username') || 'mertcetne';
    const width = parseInt(url.searchParams.get('width') || '815', 10);
    const height = parseInt(url.searchParams.get('height') || '38', 10);

    let count = '0';

    try {
      // 1. Fetch current view count from komarev
      const komarevUrl = `https://komarev.com/ghpvc/?username=${encodeURIComponent(username)}&style=flat-square&_t=${Date.now()}`;
      const res = await fetch(komarevUrl, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
          'Cache-Control': 'no-cache, no-store'
        },
        cf: {
          cacheTtl: 0,
          cacheEverything: false
        }
      });

      if (res.ok) {
        const svgText = await res.text();
        // Extract count text from komarev's SVG (<text ...>1234</text>)
        const matches = [...svgText.matchAll(/<text[^>]*>([^<]+)<\/text>/g)].map(m => m[1].trim());
        if (matches.length > 0) {
          const rawCount = matches[matches.length - 1];
          // If purely numeric, format with commas (e.g., 1428 -> 1,428)
          if (/^\d+$/.test(rawCount)) {
            count = Number(rawCount).toLocaleString('en-US');
          } else {
            count = rawCount;
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch from komarev:', err);
      // Fallback count in case komarev is temporarily down
      count = '1';
    }

    const chatMessage = `${count} users have joined the profile`;

    // 2. Generate authentic Minecraft Chat SVG
    // Colors:
    // - Background: rgba(0, 0, 0, 0.5) (Minecraft standard chat opacity)
    // - Foreground Text: #ffff55 (Minecraft standard §e yellow for join messages)
    // - Shadow Text: #3f3f15 (Minecraft standard yellow text-shadow offset by 2px)
    // - Font: 'Press Start 2P'
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
  <defs>
    <style>
      @import url('https://fonts.googleapis.com/css2?family=Press+Start+2P&amp;display=swap');
      .mc-chat-text {
        font-family: 'Press Start 2P', monospace, sans-serif;
        font-size: 12px;
        letter-spacing: 0.5px;
        dominant-baseline: middle;
      }
    </style>
  </defs>

  <!-- Semi-transparent dark chat background -->
  <rect width="100%" height="100%" fill="rgba(0, 0, 0, 0.5)" />

  <!-- Drop Shadow layer (offset +2px x & y) -->
  <text x="18" y="21" fill="#3f3f15" class="mc-chat-text">${escapeXml(chatMessage)}</text>

  <!-- Primary Minecraft Yellow layer -->
  <text x="16" y="19" fill="#ffff55" class="mc-chat-text">${escapeXml(chatMessage)}</text>
</svg>`;

    return new Response(svg, {
      headers: {
        'Content-Type': 'image/svg+xml; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate, max-age=0, s-maxage=0',
        'CDN-Cache-Control': 'no-store, max-age=0',
        'Cloudflare-CDN-Cache-Control': 'no-store, max-age=0',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*'
      }
    });
  }
};

function escapeXml(unsafe) {
  return unsafe.replace(/[<>&'"]/g, c => {
    switch (c) {
      case '<': return '&lt;';
      case '>': return '&gt;';
      case '&': return '&amp;';
      case '\'': return '&apos;';
      case '"': return '&quot;';
    }
  });
}
