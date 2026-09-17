/** Deterministic identicon-ish avatar: hue from the address, two chars from it. */
export function Avatar({ addr, label, size = 36 }: { addr: string; label?: string; size?: number }) {
  let h = 0
  for (let i = 0; i < addr.length; i++) h = (h * 31 + addr.charCodeAt(i)) % 360
  const text = (label && /^[a-z0-9]/i.test(label) ? label : addr).replace(/[^a-z0-9]/gi, '').slice(0, 2).toUpperCase()
  return (
    <span
      className="avatar"
      aria-hidden
      style={{ width: size, height: size, fontSize: size * 0.38, background: `hsl(${h} 45% 28%)`, color: `hsl(${h} 70% 82%)` }}
    >
      {text}
    </span>
  )
}
