import { Counter, Gauge, Registry, collectDefaultMetrics } from 'prom-client';

export const metricsRegistry = new Registry();

collectDefaultMetrics({ register: metricsRegistry });

export const wsConnectionsGauge = new Gauge({
  name: 'relay_ws_connections',
  help: 'Current number of websocket connections',
  registers: [metricsRegistry],
});

export const wsMessageSendCounter = new Counter({
  name: 'relay_ws_message_send_total',
  help: 'Total number of message:send events received',
  registers: [metricsRegistry],
});

export const wsMessageBroadcastCounter = new Counter({
  name: 'relay_ws_message_broadcast_total',
  help: 'Total number of message:receive emits performed by server',
  registers: [metricsRegistry],
});

