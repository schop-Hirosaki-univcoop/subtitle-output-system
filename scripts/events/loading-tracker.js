export class LoadingTracker {
  constructor({ onChange } = {}) {
    this.depth = 0;
    this.message = "";
    this.onChange = typeof onChange === "function" ? onChange : () => {};
  }

  begin(message = "") {
    this.depth += 1;
    if (message || !this.message) {
      this.message = message;
    }
    this.onChange(this.getState());
  }

  end() {
    this.depth = Math.max(0, this.depth - 1);
    if (this.depth === 0) {
      this.message = "";
    }
    this.onChange(this.getState());
  }

  updateMessage(message = "") {
    if (this.depth === 0) {
      this.message = "";
      this.onChange(this.getState());
      return;
    }
    this.message = message || this.message;
    this.onChange(this.getState());
  }

  reset() {
    this.depth = 0;
    this.message = "";
    this.onChange(this.getState());
  }

  isActive() {
    return this.depth > 0;
  }

  getState() {
    return { active: this.isActive(), message: this.message };
  }
}
