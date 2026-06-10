let msgCounter = 0;

export function wrapMessage(event, payload) {
  return {
    event,
    payload,
    timestamp: Date.now(),
    messageId: `${Date.now()}-${++msgCounter}-${Math.random().toString(36).slice(2, 8)}`,
  };
}

export function sendToTarget(socket, event, data) {
  socket.emit(event, wrapMessage(event, data));
}

export function broadcastToRoom(io, roomCode, event, data) {
  io.to(roomCode).emit(event, wrapMessage(event, data));
}

export class AnswerQueue {
  constructor(processFn) {
    this.queue = [];
    this.processing = false;
    this.processFn = processFn;
  }

  enqueue(socket, data) {
    this.queue.push({ socket, data, enqueuedAt: Date.now() });
    if (!this.processing) {
      this.processing = true;
      setImmediate(() => this.processNext());
    }
  }

  async processNext() {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      try {
        await this.processFn(item.socket, item.data);
      } catch (err) {
        console.error("AnswerQueue processing error:", err);
      }
    }
    this.processing = false;
  }
}
