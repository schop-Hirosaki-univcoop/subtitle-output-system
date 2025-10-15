class TelopHeader extends HTMLElement {
  connectedCallback() {
    if (this.dataset.initialized === "true") {
      return;
    }
    this.dataset.initialized = "true";

    const brandMark = this.getAttribute("brand-mark") || "TELoP OPS";
    const tagline = this.getAttribute("tagline") || "";
    const contextLabel = this.getAttribute("context-label") || "システム情報";
    const actionsRole = this.getAttribute("actions-role");
    const actionsLabel = this.getAttribute("actions-label");

    const existingChildren = Array.from(this.children);
    this.innerHTML = "";

    const header = document.createElement("header");
    header.className = "op-header";

    const inner = document.createElement("div");
    inner.className = "header-inner";

    const brandBlock = document.createElement("div");
    brandBlock.className = "brand-block";
    brandBlock.setAttribute("aria-label", contextLabel);

    const markSpan = document.createElement("span");
    markSpan.className = "brand-mark";
    markSpan.textContent = brandMark;
    brandBlock.appendChild(markSpan);

    if (tagline) {
      const taglineSpan = document.createElement("span");
      taglineSpan.className = "brand-tagline";
      taglineSpan.textContent = tagline;
      brandBlock.appendChild(taglineSpan);
    }

    const actions = document.createElement("div");
    actions.className = "header-actions";

    const metaContainer = document.createElement("div");
    metaContainer.className = "header-meta";

    const controlsContainer = document.createElement("div");
    controlsContainer.className = "header-controls";
    if (actionsRole) {
      controlsContainer.setAttribute("role", actionsRole);
    }
    if (actionsLabel) {
      controlsContainer.setAttribute("aria-label", actionsLabel);
    }

    const appendContainer = (container) => {
      if (!container.parentElement) {
        actions.appendChild(container);
      }
    };

    existingChildren.forEach(child => {
      const slot = child.getAttribute("slot");
      if (slot === "actions") {
        appendContainer(controlsContainer);
        controlsContainer.appendChild(child);
      } else if (slot === "meta") {
        appendContainer(metaContainer);
        metaContainer.appendChild(child);
      } else {
        appendContainer(metaContainer);
        metaContainer.appendChild(child);
      }
    });

    inner.appendChild(brandBlock);
    if (actions.childElementCount > 0) {
      inner.appendChild(actions);
    }

    header.appendChild(inner);
    this.appendChild(header);
  }
}

class TelopFooter extends HTMLElement {
  connectedCallback() {
    if (this.dataset.initialized === "true") {
      return;
    }
    this.dataset.initialized = "true";

    const highlight = this.getAttribute("highlight") || "23schop Maruo Kyohei";
    const yearAttr = this.getAttribute("year");
    const year = yearAttr ? Number(yearAttr) : new Date().getFullYear();

    const footer = document.createElement("footer");
    footer.className = "site-footer";

    const createdLine = document.createElement("div");
    createdLine.className = "credit-line";
    createdLine.append(document.createTextNode("Created by "));
    const highlightSpan = document.createElement("span");
    highlightSpan.className = "credit-highlight";
    highlightSpan.textContent = highlight;
    createdLine.appendChild(highlightSpan);

    const copyrightLine = document.createElement("div");
    copyrightLine.className = "credit-line";
    const copyrightSymbol = document.createTextNode("© ");
    const yearSpan = document.createElement("span");
    yearSpan.id = "copyright-year";
    yearSpan.textContent = String(year);
    const suffix = document.createTextNode(" Hirosaki Univ. Co-op. SCHOP");
    copyrightLine.append(copyrightSymbol, yearSpan, suffix);

    footer.appendChild(createdLine);
    footer.appendChild(copyrightLine);

    this.innerHTML = "";
    this.appendChild(footer);
  }
}

if (!customElements.get("telop-header")) {
  customElements.define("telop-header", TelopHeader);
}

if (!customElements.get("telop-footer")) {
  customElements.define("telop-footer", TelopFooter);
}
