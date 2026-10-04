import { useEffect, useRef } from 'react';
import { getSocket, initSocket } from '../services/socket';

/**
 * Calls `onEvent(evt)` whenever the server pushes a `payment_status` event
 * (optionally only for one paymentId). Pages keep a slow polling fallback.
 */
export default function usePaymentEvents(onEvent, filterPaymentId = null) {
  const callback = useRef(onEvent);
  callback.current = onEvent;

  useEffect(() => {
    const socket = getSocket() || initSocket();
    if (!socket) return undefined;

    const handler = (evt) => {
      if (!filterPaymentId || String(evt.paymentId) === String(filterPaymentId)) {
        callback.current(evt);
      }
    };

    socket.on('payment_status', handler);
    return () => socket.off('payment_status', handler);
  }, [filterPaymentId]);
}
