'use strict';

(() => {
  const $ = id => document.getElementById(id);
  const { width: W, height: H, maxFrames } = PanelGif.limits;
  let frames = [new Uint8Array(W * H * 3)], durations = [130], selected = 0;
  let tool = 'pencil', playing = true, originalBytes = null, revision = 0;
  let speed = 8, importedTiming = false;
  let stroke = null, lastPixel = null, cursor = [0, 0], keyboardCursor = false;
  let previewStart = performance.now(), previewIndex = -1, importRevision = 0;
  const history = [];
  const drawing = $('gifDrawing'), preview = $('gifPreview');

  function feedback(text = '', error = false) {
    $('gifEditorStatus').textContent = text;
    $('gifEditorStatus').classList.toggle('error', error);
  }

  function drawFrame(canvas, frame) {
    const ctx = canvas.getContext('2d');
    const image = ctx.createImageData(W, H);
    for (let p = 0; p < W * H; p++) {
      image.data.set(frame.subarray(p * 3, p * 3 + 3), p * 4);
      image.data[p * 4 + 3] = 255;
    }
    ctx.putImageData(image, 0, 0);
  }

  const smallCanvas = document.createElement('canvas');
  smallCanvas.width = W; smallCanvas.height = H;
  function drawEditor() {
    const displayWidth = drawing.getBoundingClientRect().width;
    const scale = window.devicePixelRatio || 1;
    if (displayWidth > 0) {
      drawing.width = Math.round(displayWidth * scale);
      drawing.height = Math.round(displayWidth * scale / 4);
    }
    const cellWidth = drawing.width / W, cellHeight = drawing.height / H;
    drawFrame(smallCanvas, frames[selected]);
    const ctx = drawing.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(smallCanvas, 0, 0, drawing.width, drawing.height);
    ctx.strokeStyle = '#ffffff22'; ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 1; x < W; x++) { ctx.moveTo(Math.round(x * cellWidth) + .5, 0); ctx.lineTo(Math.round(x * cellWidth) + .5, drawing.height); }
    for (let y = 1; y < H; y++) { ctx.moveTo(0, Math.round(y * cellHeight) + .5); ctx.lineTo(drawing.width, Math.round(y * cellHeight) + .5); }
    ctx.stroke();
    if (keyboardCursor) {
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 2;
      ctx.strokeRect(cursor[0] * cellWidth + 1, cursor[1] * cellHeight + 1, cellWidth - 2, cellHeight - 2);
    }
    previewIndex = -1;
  }

  function checkpoint() {
    history.push({ frames: frames.map(f => f.slice()), durations: [...durations], selected, originalBytes, speed, importedTiming });
    if (history.length > 12) history.shift();
  }

  function changed() {
    originalBytes = null;
    revision++;
    feedback();
    render();
  }

  function frameDelay() { return Math.round(100 / speed) * 10; }

  function render() {
    drawEditor();
    $('gifFrameLabel').textContent = `Image ${selected + 1} / ${frames.length}`;
    $('gifDelete').disabled = frames.length === 1;
    $('gifAdd').disabled = $('gifDuplicate').disabled = frames.length >= maxFrames;
    $('gifUndo').disabled = !history.length;
    $('gifFps').value = speed;
    $('gifFpsValue').textContent = importedTiming ? 'rythme du fichier' : `${speed} images/s`;
    const seconds = durations.reduce((sum, delay) => sum + delay, 0) / 1000;
    $('gifDuration').textContent = `${seconds.toLocaleString('fr-FR', { maximumFractionDigits: 2 })} s par boucle`;
    if (seconds > 15) feedback('La boucle dépasse 15 s : augmente la vitesse ou supprime des images.', true);
    $('gifFrames').replaceChildren();
    frames.forEach((frame, index) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'gif-frame';
      button.setAttribute('aria-pressed', String(index === selected));
      button.setAttribute('aria-label', `Image ${index + 1}, ${durations[index]} millisecondes`);
      const canvas = document.createElement('canvas');
      canvas.width = W; canvas.height = H;
      drawFrame(canvas, frame);
      button.append(canvas, document.createTextNode(`${index + 1} · ${durations[index]} ms`));
      button.onclick = () => { selected = index; render(); };
      $('gifFrames').appendChild(button);
    });
  }

  function color() {
    return tool === 'eraser' ? [0, 0, 0] : $('gifColor').value.match(/[a-f\d]{2}/gi).map(v => parseInt(v, 16));
  }

  function paint(x, y) { frames[selected].set(color(), (y * W + x) * 3); }

  function fill(x, y) {
    const frame = frames[selected], replacement = color();
    const start = y * W + x, target = frame.slice(start * 3, start * 3 + 3);
    if (target.every((v, i) => v === replacement[i])) return;
    const stack = [start], visited = new Set();
    while (stack.length) {
      const pixel = stack.pop();
      if (visited.has(pixel)) continue;
      visited.add(pixel);
      if (!target.every((v, i) => v === frame[pixel * 3 + i])) continue;
      frame.set(replacement, pixel * 3);
      const px = pixel % W, py = Math.floor(pixel / W);
      if (px > 0) stack.push(pixel - 1);
      if (px < W - 1) stack.push(pixel + 1);
      if (py > 0) stack.push(pixel - W);
      if (py < H - 1) stack.push(pixel + W);
    }
  }

  function point(event) {
    const rect = drawing.getBoundingClientRect();
    return [Math.max(0, Math.min(W - 1, Math.floor((event.clientX - rect.left) / rect.width * W))),
      Math.max(0, Math.min(H - 1, Math.floor((event.clientY - rect.top) / rect.height * H)))];
  }

  function line(from, to) {
    const steps = Math.max(Math.abs(to[0] - from[0]), Math.abs(to[1] - from[1]), 1);
    for (let step = 0; step <= steps; step++) {
      paint(Math.round(from[0] + (to[0] - from[0]) * step / steps),
        Math.round(from[1] + (to[1] - from[1]) * step / steps));
    }
  }

  drawing.addEventListener('pointerdown', event => {
    if (event.button !== 0 || stroke !== null) return;
    event.preventDefault(); drawing.focus({ preventScroll: true });
    checkpoint(); stroke = event.pointerId; keyboardCursor = false;
    drawing.setPointerCapture(event.pointerId);
    lastPixel = point(event);
    if (tool === 'fill') fill(...lastPixel); else paint(...lastPixel);
    originalBytes = null; revision++; drawEditor();
  });
  drawing.addEventListener('pointermove', event => {
    if (stroke !== event.pointerId || tool === 'fill') return;
    const next = point(event);
    line(lastPixel, next); lastPixel = next; drawEditor();
  });
  function finishStroke() { if (stroke !== null) { stroke = null; render(); } }
  drawing.addEventListener('pointerup', finishStroke);
  drawing.addEventListener('pointercancel', finishStroke);
  drawing.addEventListener('lostpointercapture', finishStroke);
  drawing.addEventListener('keydown', event => {
    const move = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (move) {
      event.preventDefault(); keyboardCursor = true;
      cursor = [Math.max(0, Math.min(W - 1, cursor[0] + move[0])), Math.max(0, Math.min(H - 1, cursor[1] + move[1]))];
      drawEditor();
    } else if (event.key === ' ' || event.key === 'Enter') {
      event.preventDefault(); checkpoint();
      if (tool === 'fill') fill(...cursor); else paint(...cursor);
      keyboardCursor = true; changed();
    }
  });

  document.querySelectorAll('[data-tool]').forEach(button => {
    button.onclick = () => {
      tool = button.dataset.tool;
      document.querySelectorAll('[data-tool]').forEach(b => b.setAttribute('aria-pressed', String(b === button)));
    };
  });
  ['#ff8800', '#ffffff', '#ff3c70', '#ffdf38', '#64dc85', '#31c5ff', '#9e75ff', '#000000'].forEach(value => {
    const swatch = document.createElement('button');
    swatch.type = 'button'; swatch.className = 'gif-swatch'; swatch.style.background = value;
    swatch.setAttribute('aria-label', `Couleur ${value}`);
    swatch.onclick = () => { $('gifColor').value = value; document.querySelector('[data-tool="pencil"]').click(); };
    $('gifSwatches').appendChild(swatch);
  });
  $('gifZoom').onchange = () => {
    $('gifDrawingWrap').classList.toggle('zoom', $('gifZoom').checked);
    drawEditor();
  };
  window.addEventListener('resize', drawEditor);
  $('gifUndo').onclick = () => {
    const prior = history.pop(); if (!prior) return;
    ({ frames, durations, selected, originalBytes, speed, importedTiming } = prior);
    revision++; feedback(); render();
  };
  function addFrame(duplicate) {
    if (frames.length >= maxFrames) return;
    checkpoint();
    frames.splice(selected + 1, 0, duplicate ? frames[selected].slice() : new Uint8Array(W * H * 3));
    durations.splice(selected + 1, 0, duplicate ? durations[selected] : frameDelay());
    selected++; changed();
    $('gifFrames').children[selected].scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  $('gifAdd').onclick = () => addFrame(false);
  $('gifDuplicate').onclick = () => addFrame(true);
  $('gifDelete').onclick = () => {
    if (frames.length < 2) return;
    checkpoint(); frames.splice(selected, 1); durations.splice(selected, 1);
    selected = Math.min(selected, frames.length - 1); changed();
  };
  $('gifFps').addEventListener('change', () => {
    checkpoint(); speed = Number($('gifFps').value); importedTiming = false;
    durations = frames.map(() => frameDelay());
    previewStart = performance.now(); changed();
  });
  $('gifPlay').onclick = () => {
    playing = !playing;
    $('gifPlay').textContent = playing ? 'Pause' : 'Lire';
    $('gifPlay').setAttribute('aria-pressed', String(playing));
    previewStart = performance.now(); previewIndex = -1;
  };
  function animate(time) {
    if (!$('gifEditor').hidden && !document.hidden) {
      const total = durations.reduce((a, b) => a + b, 0);
      let elapsed = (time - previewStart) % total, index = 0;
      if (playing) {
        while (index < frames.length - 1 && elapsed >= durations[index]) elapsed -= durations[index++];
      } else index = selected;
      if (previewIndex !== index) { drawFrame(preview, frames[index]); previewIndex = index; }
    }
    requestAnimationFrame(animate);
  }

  $('gifFile').onchange = async () => {
    const file = $('gifFile').files[0];
    if (!file) return;
    const request = ++importRevision, before = revision;
    try {
      if (file.size > PanelGif.limits.maxBytes) throw new Error('Le GIF dépasse 512 Ko.');
      const bytes = new Uint8Array(await file.arrayBuffer());
      const decoded = PanelGif.decode(bytes);
      if (request !== importRevision || revision !== before) return;
      checkpoint();
      frames = decoded.frames; durations = decoded.durations; originalBytes = bytes; selected = 0; revision++;
      $('gifName').value = file.name.replace(/\.gif$/i, '').slice(0, 60);
      importedTiming = true;
      previewStart = performance.now(); render();
      feedback(`GIF vérifié : ${frames.length} image${frames.length > 1 ? 's' : ''}. Tu peux le modifier ou l’envoyer.`);
    } catch (error) { if (request === importRevision) feedback(error.message, true); }
    finally { $('gifFile').value = ''; }
  };

  function exportGif() {
    const bytes = originalBytes || PanelGif.encode(frames, durations);
    PanelGif.decode(bytes);
    return bytes;
  }
  $('gifDownload').onclick = () => {
    try {
      const url = URL.createObjectURL(new Blob([exportGif()], { type: 'image/gif' }));
      const link = document.createElement('a');
      link.href = url; link.download = ($('gifName').value.trim() || 'mon-animation') + '.gif';
      link.click(); setTimeout(() => URL.revokeObjectURL(url), 1000);
      feedback('GIF téléchargé.');
    } catch (error) { feedback(error.message, true); }
  };
  $('gifSubmit').onclick = () => {
    try {
      const bytes = exportGif();
      let binary = '';
      for (let p = 0; p < bytes.length; p += 8192) binary += String.fromCharCode(...bytes.subarray(p, p + 8192));
      window.dispatchEvent(new CustomEvent('public-gif-submit', { detail: { gif: btoa(binary), name: $('gifName').value } }));
    } catch (error) { feedback(error.message, true); }
  };
  function selectMode(gif) {
    $('messageForm').hidden = gif; $('gifEditor').hidden = !gif;
    $('textTab').setAttribute('aria-pressed', String(!gif)); $('gifTab').setAttribute('aria-pressed', String(gif));
    document.querySelector('main').classList.toggle('gif-mode', gif);
    if (gif) drawEditor();
    previewIndex = -1;
  }
  $('textTab').onclick = () => selectMode(false);
  $('gifTab').onclick = () => selectMode(true);
  render(); requestAnimationFrame(animate);
})();
