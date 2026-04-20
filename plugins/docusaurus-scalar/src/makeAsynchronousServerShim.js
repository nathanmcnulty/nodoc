function ensureNotAborted(signal) {
  if (typeof signal?.throwIfAborted === "function") {
    signal.throwIfAborted();
  }
}

export default function makeAsynchronous(function_) {
  const fn = async (...arguments_) => {
    return function_(...arguments_);
  };

  fn.withSignal = (signal) => async (...arguments_) => {
    ensureNotAborted(signal);
    const result = function_(...arguments_);
    ensureNotAborted(signal);
    return result;
  };

  return fn;
}

export function makeAsynchronousIterable(function_) {
  const fn = (...arguments_) => ({
    async * [Symbol.asyncIterator]() {
      for (const value of function_(...arguments_)) {
        yield value;
      }
    },
  });

  fn.withSignal = (signal) => (...arguments_) => ({
    async * [Symbol.asyncIterator]() {
      ensureNotAborted(signal);
      for (const value of function_(...arguments_)) {
        ensureNotAborted(signal);
        yield value;
      }
    },
  });

  return fn;
}