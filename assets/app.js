// Years in product, counted from 2016 like the bot (recruiter-bot lib/career.ts),
// so "10+" becomes "11+" on 1 January with no edit. The HTML holds 10 as fallback.
(function () {
  var n = new Date().getFullYear() - 2016;
  if (n >= 10) document.querySelectorAll('.yrs').forEach(function (el) { el.textContent = n; });
})();

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

// Project videos: still until asked. Mouse: plays while hovered, until the
// visitor uses the play button or clicks a video; from then on it is theirs.
// Touch, or keyboard: tap / Enter / Space plays and pauses. Slowed to 70%.
// A .duo (desktop + phone recording) plays and pauses as one, and its control
// bar (play/pause, time, timeline) follows the desktop recording.
(function () {
  var hover = window.matchMedia('(hover: hover) and (pointer: fine)').matches;
  var groups = [].slice.call(document.querySelectorAll('.duo'));
  document.querySelectorAll('.vid').forEach(function (b) { if (!b.closest('.duo')) groups.push(b); });
  function fmt(t) { t = Math.max(0, Math.floor(t || 0)); return Math.floor(t / 60) + ':' + ('0' + (t % 60)).slice(-2); }
  groups.forEach(function (box) {
    var vids = [].slice.call(box.querySelectorAll('video'));
    var main = vids[0];
    var manual = false;
    function play() {
      vids.forEach(function (v) { v.playbackRate = 0.7; var p = v.play(); if (p && p.catch) p.catch(function () {}); });
    }
    function pause() { vids.forEach(function (v) { v.pause(); }); }
    function toggle() { if (main.paused) play(); else pause(); }
    function take() { manual = true; toggle(); }
    vids.forEach(function (v) {
      v.defaultPlaybackRate = 0.7;
      v.addEventListener('click', take);
      v.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); take(); }
      });
    });
    main.addEventListener('play', function () { box.classList.add('is-playing'); });
    main.addEventListener('pause', function () { box.classList.remove('is-playing'); });

    var bar = box.querySelector('.vc');
    if (bar) {
      var btn = bar.querySelector('.vc-play'), time = bar.querySelector('.vc-time'), seek = bar.querySelector('.vc-seek');
      var dragging = false;
      function sync() {
        var d = main.duration || 0;
        time.textContent = fmt(main.currentTime) + ' / ' + fmt(d);
        if (!dragging && d) seek.value = Math.round(main.currentTime / d * 1000);
        seek.style.setProperty('--p', (seek.value / 10) + '%');
      }
      main.addEventListener('timeupdate', sync);
      main.addEventListener('loadedmetadata', sync);
      main.addEventListener('play', function () { btn.setAttribute('aria-label', 'Pause the recordings'); });
      main.addEventListener('pause', function () { btn.setAttribute('aria-label', 'Play the recordings'); });
      btn.addEventListener('click', take);
      seek.addEventListener('input', function () {
        manual = true; dragging = true;
        if (main.duration) main.currentTime = seek.value / 1000 * main.duration;
        sync();
      });
      seek.addEventListener('change', function () { dragging = false; });
      sync();
    }

    if (hover) {
      box.addEventListener('mouseenter', function () { if (!manual) play(); });
      box.addEventListener('mouseleave', function () { if (!manual) pause(); });
    } else {
      var hint = document.querySelector('.shots-hint');
      if (hint) hint.hidden = false;
    }
  });
})();
