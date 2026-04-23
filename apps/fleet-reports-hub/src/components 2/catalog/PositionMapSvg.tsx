type Props = {
  positionMapType: string | null
  compact?: boolean
}

/** Top-view schematic for tire-related services (demo). */
export function PositionMapSvg({ positionMapType, compact }: Props) {
  const steer = positionMapType === 'tire_steer_axle'
  const drive = positionMapType === 'tire_drive_axles'

  if (!steer && !drive) return null

  const w = compact ? 340 : 440
  const steerY = 32
  const driveY = steer ? 96 : 32
  const h = steer && drive ? 156 : 104

  return (
    <div className="pos-map" aria-label="Tire position map">
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} className="pos-map__svg">
        <rect x="4" y="4" width={w - 8} height={h - 8} rx="8" fill="#12151c" stroke="#2a3142" />
        <text x={w / 2} y="18" textAnchor="middle" fill="#9aa3b5" fontSize="11">
          Cab left · front → rear (demo)
        </text>
        {steer && (
          <g>
            <rect x="20" y={steerY} width="46" height="40" rx="6" fill="#1e3a5f" stroke="#5b8cff" />
            <rect x="72" y={steerY} width="46" height="40" rx="6" fill="#1e3a5f" stroke="#5b8cff" />
            <text x="43" y={steerY + 26} textAnchor="middle" fill="#e7e9ee" fontSize="11" fontWeight="600">
              S1
            </text>
            <text x="95" y={steerY + 26} textAnchor="middle" fill="#e7e9ee" fontSize="11" fontWeight="600">
              S2
            </text>
            <text x="69" y={steerY + 52} textAnchor="middle" fill="#93c5fd" fontSize="10">
              Steer axle
            </text>
          </g>
        )}
        {drive && (
          <g>
            {Array.from({ length: 8 }, (_, i) => {
              const base = 16
              const x = base + i * ((w - 32) / 8)
              return (
                <rect
                  key={i}
                  x={x}
                  y={driveY}
                  width="36"
                  height="40"
                  rx="4"
                  fill="#143d32"
                  stroke="#3dd6c3"
                />
              )
            })}
            <text x={w / 2} y={driveY + 54} textAnchor="middle" fill="#6ee7b7" fontSize="10">
              Drive axles (L1–L8)
            </text>
          </g>
        )}
      </svg>
    </div>
  )
}
