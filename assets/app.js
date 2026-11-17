// Theme toggle: remembers the choice in this browser only.
(function () {
  var root = document.documentElement;
  var btn = document.querySelector('.theme-toggle');
  btn.addEventListener('click', function () {
    var dark = root.dataset.theme
      ? root.dataset.theme === 'dark'
      : window.matchMedia('(prefers-color-scheme: dark)').matches;
    root.dataset.theme = dark ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
  });
})();

// "Ask my agent": talks to the existing assistant at ask-ehsan.vercel.app.
(function () {
  var API = 'https://ask-ehsan.vercel.app/api/chat';
  var MAX_TURNS = 10;
  var log = document.getElementById('log');
  var form = document.getElementById('ask-form');
  var input = document.getElementById('q');
  var send = form.querySelector('.send');
  var chips = document.getElementById('chips');
  var messages = [];
  var busy = false;

  function esc(s) {
    return s.replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  // Escape first, then allow bold and https links only.
  function render(md) {
    return esc(md)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\[([^\]]+)\]\((https:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|\s)(https:\/\/[^\s<]+[^\s<.,)])/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>')
      .replace(/^#+\s*/gm, '')
      .replace(/^[-*]\s+/gm, '• ');
  }
  function line(cls, html) {
    var p = document.createElement('p');
    p.className = cls;
    p.innerHTML = html;
    log.appendChild(p);
    log.scrollTop = log.scrollHeight;
    return p;
  }

  async function ask(q) {
    q = q.trim();
    if (!q || busy) return;
    if (messages.length >= MAX_TURNS * 2) {
      line('sys', 'That is the limit for one visit. Email me for more: <a href="mailto:ehsan.fazlhashemi@gmail.com">ehsan.fazlhashemi@gmail.com</a>');
      return;
    }
    busy = true; send.disabled = true; chips.hidden = true;
    line('you', esc(q));
    messages.push({ role: 'user', content: q.slice(0, 500) });
    var out = line('bot', '<span class="cursor">_</span>');
    var text = '';
    try {
      var res = await fetch(API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: messages })
      });
      if (!res.ok || !res.body) throw new Error('status ' + res.status);
      var reader = res.body.getReader();
      var dec = new TextDecoder();
      for (;;) {
        var r = await reader.read();
        if (r.done) break;
        text += dec.decode(r.value, { stream: true });
        out.innerHTML = render(text) + '<span class="cursor">_</span>';
        log.scrollTop = log.scrollHeight;
      }
      out.innerHTML = render(text);
      messages.push({ role: 'assistant', content: text });
    } catch (e) {
      messages.pop();
      out.className = 'err';
      out.innerHTML = 'Could not reach the assistant. Try <a href="https://ask-ehsan.vercel.app">ask-ehsan.vercel.app</a> instead.';
    }
    busy = false; send.disabled = false;
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var q = input.value;
    input.value = '';
    input.style.height = '';
    ask(q);
  });
  input.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); form.requestSubmit(); }
  });
  input.addEventListener('input', function () {
    input.style.height = 'auto';
    input.style.height = input.scrollHeight + 'px';
  });
  chips.addEventListener('click', function (e) {
    if (e.target.tagName === 'BUTTON') ask(e.target.textContent);
  });
})();

// Project videos: no autoplay for people who ask for less motion.
// CSS can't stop autoplay, so drop it, show the poster and a play control.
(function () {
  var mq = window.matchMedia('(prefers-reduced-motion: reduce)');
  function apply() {
    if (!mq.matches) return;
    document.querySelectorAll('video[autoplay]').forEach(function (v) {
      v.removeAttribute('autoplay');
      v.autoplay = false;
      v.pause();
      v.controls = true;
      v.load();
    });
  }
  apply();
  if (mq.addEventListener) mq.addEventListener('change', apply);

  // Play only while on screen (saves battery), and start reliably even when
  // the browser skipped autoplay for an off-screen video.
  if (!('IntersectionObserver' in window)) return;
  var io = new IntersectionObserver(function (entries) {
    entries.forEach(function (e) {
      var v = e.target;
      if (mq.matches || !v.autoplay) return;
      if (e.isIntersecting) { var p = v.play(); if (p && p.catch) p.catch(function () { v.controls = true; }); }
      else v.pause();
    });
  }, { threshold: 0.25 });
  document.querySelectorAll('video[autoplay]').forEach(function (v) { io.observe(v); });
})();
