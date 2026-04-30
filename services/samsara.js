const BASE_URL = 'https://api.samsara.com';
const SAMSARA_TIMEOUT_MS = 10000;

export async function samsaraGet(path, token, query = {}) {
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== '') url.searchParams.set(key, value);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SAMSARA_TIMEOUT_MS);
  let response;
  try {
    response = await fetch(url, {
      signal: controller.signal,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json'
      }
    });
  } catch (error) {
    if (error?.name === 'AbortError') {
      const timeoutError = new Error(`Samsara request timed out after ${SAMSARA_TIMEOUT_MS}ms`);
      timeoutError.status = 504;
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
  const data = await response.json();
  if (!response.ok) {
    const error = new Error(data?.message || `Samsara request failed: ${response.status}`);
    error.status = response.status;
    error.details = data;
    throw error;
  }
  return data;
}

export async function getVehicleStats(token, vehicleIds = '') {
  return samsaraGet('/fleet/vehicles/stats', token, {
    types: 'gps,fuelPercents,engineStates',
    vehicleIds: vehicleIds || undefined
  });
}

export async function getHosClocks(token) {
  return samsaraGet('/fleet/hos/clocks', token, {});
}

export async function getDriverVehicleAssignments(token, query = {}) {
  return samsaraGet('/fleet/driver-vehicle-assignments', token, query);
}

export async function getVehicles(token) {
  return samsaraGet('/fleet/vehicles', token, {});
}
