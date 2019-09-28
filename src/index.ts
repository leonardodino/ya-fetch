type RequestMethods = 'GET' | 'POST' | 'PATCH' | 'PUT' | 'HEAD' | 'DELETE'
type ContentTypes = 'json' | 'text' | 'formData' | 'arrayBuffer' | 'blob'

type RequestFn = (resource: string, options?: Options) => RequestBody

interface RequestBody extends Promise<Response> {
  json?<T>(): Promise<T>
  text?(): Promise<string>
  blob?(): Promise<Blob>
  arrayBuffer?(): Promise<ArrayBuffer>
  formData?(): Promise<FormData>
}

interface Options extends RequestInit {
  /** Object that will be stringified with `JSON.stringify` */
  json?: unknown
  /** Object that can be passed to `serialize` */
  params?: unknown
  /** Throw `TimeoutError`if timeout is passed */
  timeout?: number
  /** String that will prepended to `resource` in `fetch` instance */
  prefixUrl?: string
  /** Request headers */
  headers?: Record<string, string>
  /** Custom params serializer, default to `URLSearchParams` */
  serialize?(params: Options['params']): string
  /** Response handler, must handle status codes or throw `ResponseError` */
  onResponse?(response: Response): Response
  /** Response handler with sucess status codes 200-299 */
  onSuccess?(value: Response): Response
  /** Error handler, must throw an `Error` */
  onFailure?(error: Error): never
}

interface Instance extends RequestFn {
  create(options?: Options): Instance
  extend(options?: Options): Instance
  options: Options
  get: RequestFn
  post: RequestFn
  put: RequestFn
  patch: RequestFn
  head: RequestFn
  delete: RequestFn
}

const { keys, assign } = Object
const merge = <T>(a?: T, b?: T, c?: T): T => assign({}, a, b, c)

const mergeOptions = (left: Options = {}, right: Options = {}) =>
  merge<Options>(left, right, {
    headers: merge(left.headers, right.headers),
    params: right.params ? merge(left.params, right.params) : left.params,
  })

const CONTENT_TYPES: Record<ContentTypes, string> = {
  json: 'application/json',
  text: 'text/*',
  formData: 'multipart/form-data',
  arrayBuffer: '*/*',
  blob: '*/*',
}

function ResponseError(response: Response) {
  return assign(new Error(response.statusText), {
    name: 'ResponseError',
    response: response,
  })
}

function TimeoutError() {
  return assign(new Error('Request timed out'), {
    name: 'TimeoutError',
  })
}

function isAborted(error: Error) {
  return error.name === 'AbortError'
}

function isTimeout(error: Error) {
  return error.name === 'TimeoutError'
}

const DEFAULT_OPTIONS: Options = {
  prefixUrl: '',
  credentials: 'same-origin',
  serialize(params: URLSearchParams) {
    return new URLSearchParams(params).toString()
  },
  onResponse(response) {
    if (response.ok) {
      return response
    }

    throw ResponseError(response)
  },
  onSuccess(response) {
    return response
  },
  onFailure(error) {
    throw error
  },
}

function request(baseResource: string, baseInit: Options): RequestBody {
  const opts = mergeOptions(DEFAULT_OPTIONS, baseInit)
  const query = opts.params == null ? '' : '?' + opts.serialize(opts.params)
  const resource = opts.prefixUrl + baseResource + query

  if (opts.json != null) {
    opts.body = JSON.stringify(opts.json)
    opts.headers['content-type'] = CONTENT_TYPES.json
  }

  const promise: RequestBody = new Promise<Response>((resolve, reject) => {
    let timerID: any

    if (opts.timeout > 0) {
      if (typeof AbortController === 'function') {
        const controller = new AbortController()

        timerID = setTimeout(() => {
          reject(TimeoutError())
          controller.abort()
        }, opts.timeout)

        if (opts.signal != null) {
          opts.signal.addEventListener('abort', () => {
            clearTimeout(timerID)
            controller.abort()
          })
        }

        opts.signal = controller.signal
      } else {
        timerID = setTimeout(() => reject(TimeoutError()), opts.timeout)
      }
    }

    // Running fetch in next tick allow us to set headers after creating promise
    setTimeout(() =>
      fetch(resource, opts)
        .then(opts.onResponse)
        .then(resolve, reject)
        .then(() => clearTimeout(timerID))
    )
  }).then(opts.onSuccess, opts.onFailure)

  return (keys(CONTENT_TYPES) as ContentTypes[]).reduce<RequestBody>(
    (acc, key) => {
      acc[key] = () => {
        opts.headers.accept = CONTENT_TYPES[key]
        return promise
          .then((response) => response.clone())
          .then((response) => response[key]())
      }
      return acc
    },
    promise
  )
}

function create(baseOptions?: Options): Instance {
  const extend = (options: Options) =>
    create(mergeOptions(baseOptions, options))

  const createMethod = (method: RequestMethods) => (
    resource: string,
    options?: Options
  ) => request(resource, mergeOptions(baseOptions, merge({ method }, options)))

  const intance = {
    create,
    extend,
    options: baseOptions,
    get: createMethod('GET'),
    post: createMethod('POST'),
    put: createMethod('PUT'),
    patch: createMethod('PATCH'),
    head: createMethod('HEAD'),
    delete: createMethod('DELETE'),
  }

  return assign(intance.get, intance)
}

export { create, request, isAborted, isTimeout, ResponseError, TimeoutError }

export default create()
