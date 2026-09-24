export class ApiError extends Error {
  constructor(message, { status = 0, outcomeUnknown = false } = {}) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.outcomeUnknown = outcomeUnknown;
  }
}

async function request(path, { method = 'GET', body } = {}) {
  const controller = new AbortController();
  const isCommand = method === 'POST';

  const timer = setTimeout(
    () => controller.abort(),
    isCommand ? 12000 : 5000,
  );

  try {
    const response = await fetch(path, {
      method,
      signal: controller.signal,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: body === undefined
        ? { Accept: 'application/json' }
        : {
            Accept: 'application/json',
            'Content-Type': 'application/json',
          },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let data;

    try {
      data = await response.json();
    } catch {
      throw new ApiError('Could not read the backend response.', {
        status: response.status,
        outcomeUnknown: isCommand,
      });
    }

    if (response.status === 401) location.replace('/login');
    if (!response.ok) {
      throw new ApiError(
        typeof data?.error === 'string'
          ? data.error
          : 'Request failed.',
        {
          status: response.status,
          outcomeUnknown: isCommand && response.status >= 500,
        },
      );
    }

    return data;
  } catch (error) {
    if (error instanceof ApiError) throw error;

    throw new ApiError(
      error.name === 'AbortError'
        ? 'Backend response timed out.'
        : 'Could not connect to the backend.',
      { outcomeUnknown: isCommand },
    );
  } finally {
    clearTimeout(timer);
  }
}

function inspectionPath(requestId) {
  if (
    typeof requestId !== 'string' ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(requestId)
  ) {
    throw new ApiError('A valid inspection request ID is required.');
  }

  return '/api/inspections/' + requestId;
}

export const api = {
  me: () => request('/api/auth/me'),
  getHealth: () => request('/health'),
  getRobotState: () => request('/api/robot/state'),
  getCurrentInspection: () => request('/api/inspections/current'),

  startInspection(fields) {
    return request('/api/inspections', {
      method: 'POST',
      body: {
        plant: fields.plant,
        turbine: fields.turbine,
        blade: fields.blade,
        section: fields.section,
        operator_name: fields.operator_name,
        drive_mode: 'manual',
      },
    });
  },

  finishInspection(requestId) {
    return request(inspectionPath(requestId) + '/finish', {
      method: 'POST',
      body: {},
    });
  },

  cancelInspection(requestId) {
    return request(inspectionPath(requestId) + '/cancel', {
      method: 'POST',
      body: {},
    });
  },
};
