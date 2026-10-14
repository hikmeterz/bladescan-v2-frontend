// JSON API client shared by every page.
export class ApiError extends Error {
  constructor(message, { status = 0, outcomeUnknown = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    // A command whose result could not be confirmed must not be retried blindly.
    this.outcomeUnknown = outcomeUnknown;
  }
}

export async function request(path, { method = 'GET', body, timeoutMs } = {}) {
  const isCommand = method !== 'GET';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? (isCommand ? 12000 : 5000));
  try {
    const response = await fetch(path, {
      method,
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined
        ? { Accept: 'application/json' }
        : { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    let data;
    try {
      data = await response.json();
    } catch {
      throw new ApiError('Could not read the backend response.', { status: response.status, outcomeUnknown: isCommand });
    }
    if (response.status === 401) location.replace('/login');
    if (!response.ok) {
      throw new ApiError(typeof data?.error === 'string' ? data.error : 'Request failed.', {
        status: response.status, outcomeUnknown: isCommand && response.status >= 500,
      });
    }
    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(error.name === 'AbortError' ? 'Backend response timed out.' : 'Could not connect to the backend.',
      { outcomeUnknown: isCommand });
  } finally {
    clearTimeout(timer);
  }
}

// Short form used by the dashboard modules: GET without a body, POST with one.
export function send(path, body) {
  return body === undefined
    ? request(path, { timeoutMs: 15000 })
    : request(path, { method: 'POST', body, timeoutMs: 15000 });
}

function inspectionPath(requestId) {
  if (typeof requestId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)) {
    throw new ApiError('A valid inspection request ID is required.');
  }
  return '/api/inspections/' + requestId;
}

// Named calls used by the live inspection screen.
export const api = {
  me: () => request('/api/auth/me'),
  getHealth: () => request('/health'),
  getRobotState: () => request('/api/robot/state'),
  getCurrentInspection: () => request('/api/inspections/current'),
  capturePhoto: (requestId, photoId) =>
    request(inspectionPath(requestId) + '/photo', { method: 'POST', body: { request_id: photoId } }),
  finishInspection: requestId => request(inspectionPath(requestId) + '/finish', { method: 'POST', body: {} }),
  cancelInspection: requestId => request(inspectionPath(requestId) + '/cancel', { method: 'POST', body: {} }),
};
