// Draws a student's ticket as a PNG they can keep on their phone: works at the gate without internet, since the
// scanner only reads the QR code. The QR is the same SVG shown on the page, redrawn large on a white square so
// scanners read it easily even from a dim screen.
const W = 1080
const PAD = 80
const QR = 720
const DISPLAY = '"Bricolage Grotesque", system-ui, Arial, sans-serif'
const BODY = '"DM Sans", system-ui, Arial, sans-serif'

// Splits text into at most maxLines lines that fit width, ending with … if it had to cut
function wrap(ctx, text, width, maxLines) {
  const words = String(text).split(/\s+/)
  const lines = []
  let line = ''
  for (const word of words) {
    const next = line ? `${line} ${word}` : word
    if (ctx.measureText(next).width <= width || !line) line = next
    else {
      lines.push(line)
      line = word
    }
  }
  if (line) lines.push(line)
  if (lines.length <= maxLines) return lines
  const kept = lines.slice(0, maxLines)
  while (ctx.measureText(`${kept[maxLines - 1]}…`).width > width) kept[maxLines - 1] = kept[maxLines - 1].slice(0, -1)
  kept[maxLines - 1] += '…'
  return kept
}

function svgImage(svg) {
  const copy = svg.cloneNode(true)
  copy.setAttribute('width', QR)
  copy.setAttribute('height', QR)
  const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(new XMLSerializer().serializeToString(copy))}`
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('Could not draw the QR code.'))
    img.src = url
  })
}

// svg: the rendered QR <svg>. lines: { title, when, venue, holder, email, code, note }. Resolves to a PNG Blob.
export async function ticketPng(svg, { title, when, venue, holder, email, code, note }) {
  await document.fonts?.ready
  const qr = await svgImage(svg)

  const canvas = document.createElement('canvas')
  const ctx = canvas.getContext('2d')
  canvas.width = W
  ctx.font = `700 68px ${DISPLAY}`
  const titleLines = wrap(ctx, title, W - PAD * 2, 3)
  canvas.height = 1560 + (titleLines.length - 1) * 78
  // Changing the size resets the context, so every style is set from here on
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, canvas.height)
  ctx.textBaseline = 'top'

  let y = PAD
  ctx.fillStyle = '#f4f4f2'
  ctx.font = `700 40px ${DISPLAY}`
  ctx.fillText('Swayam', PAD, y)
  const brandWidth = ctx.measureText('Swayam').width
  ctx.fillStyle = '#8c8c8c'
  ctx.font = `400 30px ${BODY}`
  ctx.fillText('E-Cell', PAD + brandWidth + 14, y + 8)
  ctx.fillStyle = '#ff9f1c'
  ctx.font = `700 26px ${BODY}`
  ctx.textAlign = 'right'
  ctx.fillText('ENTRY TICKET', W - PAD, y + 10)
  ctx.textAlign = 'left'

  y += 100
  ctx.fillStyle = '#f4f4f2'
  ctx.font = `700 68px ${DISPLAY}`
  for (const line of titleLines) {
    ctx.fillText(line, PAD, y)
    y += 78
  }
  y += 12
  ctx.fillStyle = '#cfcfcc'
  ctx.font = `400 34px ${BODY}`
  for (const line of [when, venue].filter(Boolean)) {
    y += 8
    ctx.fillText(wrap(ctx, line, W - PAD * 2, 1)[0], PAD, y)
    y += 42
  }

  y += 40
  const box = QR + 60
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  if (ctx.roundRect) ctx.roundRect((W - box) / 2, y, box, box, 28)
  else ctx.rect((W - box) / 2, y, box, box)
  ctx.fill()
  ctx.drawImage(qr, (W - QR) / 2, y + 30, QR, QR)
  y += box + 48

  ctx.textAlign = 'center'
  ctx.fillStyle = '#f4f4f2'
  ctx.font = `700 44px ${BODY}`
  ctx.fillText(wrap(ctx, holder, W - PAD * 2, 1)[0], W / 2, y)
  y += 58
  ctx.fillStyle = '#8c8c8c'
  ctx.font = `400 30px ${BODY}`
  if (email && email !== holder) {
    ctx.fillText(email, W / 2, y)
    y += 44
  }
  if (code) {
    ctx.fillStyle = '#ff9f1c'
    ctx.font = `700 32px ui-monospace, Consolas, monospace`
    ctx.fillText(code, W / 2, y + 6)
    y += 52
  }
  ctx.fillStyle = '#8c8c8c'
  ctx.font = `400 26px ${BODY}`
  for (const line of wrap(ctx, note, W - PAD * 2, 2)) {
    ctx.fillText(line, W / 2, y + 10)
    y += 36
  }

  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Could not create the image.'))), 'image/png'))
}
