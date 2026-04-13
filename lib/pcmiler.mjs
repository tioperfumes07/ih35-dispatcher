/**
 * Trimble PC*Miler / Maps REST — practical miles between two coordinates.
 * https://developer.trimblemaps.com/restful-apis/routing/route-reports/post-route-reports
 *
 * Set PCMILER_API_KEY (Authorization header value from Trimble).
 * Optional: PCMILER_DATA_VERSION (default Current), PCMILER_ROUTING_TYPE (0=Practical).
 */

const PCMILER_API_KEY = String(process.env.PCMILER_API_KEY || '').trim();
const PCMILER_DATA_VERSION = String(process.env.PCMILER_DATA_VERSION || 'Current').trim();
const PCMILER_ROUTING_TYPE = Number(process.env.PCMILER_ROUTING_TYPE ?? 0);

function latLonStr(n) {
  return String(Number(n).toFixed(6));
}

/**
 * @returns {Promise<number|null>} Practical miles, or null if not configured / failed
 */
export async function pcmilerPracticalMilesBetween(lat1, lon1, lat2, lon2) {
  if (!PCMILER_API_KEY) return null;

  const url = `https://pcmiler.alk.com/apis/rest/v1.0/Service.svc/route/routeReports?dataVersion=${encodeURIComponent(
    PCMILER_DATA_VERSION
  )}`;

  const body = {
    ReportRoutes: [
      {
        RouteId: 'leg',
        Stops: [
          {
            Coords: { Lat: latLonStr(lat1), Lon: latLonStr(lon1) },
            Region: 4,
            Label: 'From',
            ID: 'a'
          },
          {
            Coords: { Lat: latLonStr(lat2), Lon: latLonStr(lon2) },
            Region: 4,
            Label: 'To',
            ID: 'b'
          }
        ],
        Options: {
          RoutingType: Number.isFinite(PCMILER_ROUTING_TYPE) ? PCMILER_ROUTING_TYPE : 0,
          DistanceUnits: 0,
          HighwayOnly: false
        },
        ReportTypes: [
          {
            __type: 'CalculateMilesReportType:http://pcmiler.alk.com/APIs/v1.0'
          }
        ]
      }
    ]
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: PCMILER_API_KEY
    },
    body: JSON.stringify(body)
  });

  const text = await res.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  if (!res.ok) {
    console.warn('[pcmiler] HTTP', res.status, text.slice(0, 200));
    return null;
  }

  const miles = extractMilesFromReportResponse(data);
  return miles != null && Number.isFinite(miles) && miles > 0 ? Math.round(miles * 10) / 10 : null;
}

function extractMilesFromReportResponse(data) {
  let maxTm = 0;
  function walk(o) {
    if (o == null) return;
    if (Array.isArray(o)) {
      o.forEach(walk);
      return;
    }
    if (typeof o === 'object') {
      const t = o.TMiles ?? o.TotalDistance ?? o.TotalMiles ?? o.Miles;
      if (t != null && String(t).trim() !== '') {
        const n = parseFloat(String(t).replace(/,/g, ''));
        if (Number.isFinite(n) && n > maxTm) maxTm = n;
      }
      Object.values(o).forEach(walk);
    }
  }
  walk(data);
  return maxTm > 0 ? maxTm : null;
}
