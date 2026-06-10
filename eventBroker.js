import { wrapMessage } from "./ipcHelper.js";

class EventBroker {
  constructor() {
    this.subscribers = new Map();
    this.socketTopics = new Map();
  }

  subscribe(topic, socketId, socket) {
    if (!this.subscribers.has(topic)) {
      this.subscribers.set(topic, new Map());
    }
    this.subscribers.get(topic).set(socketId, socket);

    if (!this.socketTopics.has(socketId)) {
      this.socketTopics.set(socketId, []);
    }
    this.socketTopics.get(socketId).push(topic);
  }

  publish(topic, eventName, payload) {
    const subs = this.subscribers.get(topic);
    if (!subs || subs.size === 0) {
      console.log(`[EventBroker] No subscribers on topic '${topic}' for event '${eventName}'`);
      return;
    }
    const msg = wrapMessage(eventName, payload);
    for (const [, socket] of subs) {
      socket.emit(eventName, msg);
    }
    console.log(`[EventBroker] Published event '${eventName}' to ${subs.size} subscribers on topic '${topic}'`);
  }

  unsubscribeFromTopic(topic, socketId) {
    const subs = this.subscribers.get(topic);
    if (subs) {
      subs.delete(socketId);
      if (subs.size === 0) {
        this.subscribers.delete(topic);
      }
    }

    const topics = this.socketTopics.get(socketId);
    if (topics) {
      const idx = topics.indexOf(topic);
      if (idx !== -1) topics.splice(idx, 1);
      if (topics.length === 0) this.socketTopics.delete(socketId);
    }
  }

  unsubscribeAll(socketId) {
    const topics = this.socketTopics.get(socketId);
    if (topics) {
      for (const topic of topics) {
        const subs = this.subscribers.get(topic);
        if (subs) {
          subs.delete(socketId);
          if (subs.size === 0) this.subscribers.delete(topic);
        }
      }
      this.socketTopics.delete(socketId);
    }
  }
}

const eventBroker = new EventBroker();
export default eventBroker;
