// Contract types and constants shared by server and client (specs/02-architecture.md §1).
export { VIEW_PATHS, viewForPath, type View } from './views.js';
export {
  ERROR_CODES,
  ErrorDetailSchema,
  ErrorEnvelopeSchema,
  errorEnvelope,
  type ErrorCode,
  type ErrorDetail,
  type ErrorEnvelope,
} from './errors.js';
export {
  COMMAND_TYPES,
  CommandEnvelopeSchema,
  EVENT_TYPES,
  EventEnvelopeSchema,
  SOCKET_CHANNELS,
  type CommandAck,
  type CommandEnvelope,
  type CommandType,
  type EventEnvelope,
  type EventType,
} from './live.js';
