/** A short title reveal uses the live fluid already rendering behind the app. */
export function playOpeningAnimation(root: HTMLElement): void {
  const reduced = matchMedia("(prefers-reduced-motion: reduce)");
  if (reduced.matches || document.hidden || window.scrollY > 0) return;
  const title = root.querySelector<HTMLElement>(".brand-wordmark");
  const svg = title?.querySelector("svg");
  const fluid = root.querySelector<HTMLElement>(".visualizer-panel");
  if (!title || !svg || !fluid) return;
  const bounds = title.getBoundingClientRect();
  if (bounds.width <= 0) return;
  const copy = svg.cloneNode(true);
  if (!(copy instanceof SVGElement)) return;
  const identifiers = new Map<string, string>();
  for (const element of copy.querySelectorAll("[id]")) {
    identifiers.set(element.id, `opening-${element.id}`);
    element.id = `opening-${element.id}`;
  }
  for (const element of copy.querySelectorAll("*")) {
    for (const name of element.getAttributeNames()) {
      if (name === "id") continue;
      const value = element.getAttribute(name);
      if (!value) continue;
      let next = value;
      for (const [before, after] of identifiers)
        next = next.replaceAll(`#${before}`, `#${after}`);
      if (next !== value) element.setAttribute(name, next);
    }
  }
  const opening = document.createElement("div");
  opening.className = "opening-wordmark";
  opening.setAttribute("aria-hidden", "true");
  Object.assign(opening.style, {
    left: `${bounds.left}px`,
    top: `${bounds.top}px`,
    width: `${bounds.width}px`,
    height: `${bounds.height}px`,
  });
  opening.append(copy);
  root.append(opening);
  const previousVisibility = title.style.visibility;
  title.style.visibility = "hidden";
  root.dataset.opening = "true";
  const duration = 1300;
  const x = innerWidth / 2 - bounds.left - bounds.width / 2;
  const y = innerHeight * 0.42 - bounds.top - bounds.height / 2;
  const scale = Math.min(1.6, (innerWidth - 48) / bounds.width);
  const from = `translate(${x}px,${y}px) scale(${scale})`;
  const animations: Animation[] = [
    opening.animate(
      [
        { transform: from, opacity: 0, filter: "blur(5px)" },
        { transform: from, opacity: 1, filter: "blur(0px)", offset: 0.28 },
        { transform: from, opacity: 1, filter: "blur(0px)", offset: 0.5 },
        {
          transform: "translate(0,0) scale(1)",
          opacity: 1,
          filter: "blur(0px)",
        },
      ],
      { duration, easing: "cubic-bezier(.22,.7,.2,1)", fill: "both" },
    ),
  ];
  for (const element of root.querySelectorAll<HTMLElement>(
    ":scope > .app-header, :scope > .workspace, :scope > .instrument-nav",
  ))
    animations.push(
      element.animate(
        [{ opacity: 0 }, { opacity: 0, offset: 0.42 }, { opacity: 1 }],
        { duration, fill: "both" },
      ),
    );
  const intensity = Number(getComputedStyle(fluid).opacity);
  if (Number.isFinite(intensity) && intensity > 0)
    animations.push(
      fluid.animate(
        [
          { opacity: intensity },
          { opacity: Math.max(intensity, 0.6), offset: 0.28 },
          { opacity: intensity },
        ],
        { duration, fill: "both" },
      ),
    );
  let finished = false;
  let timer: ReturnType<typeof setTimeout>;
  const finish = (): void => {
    if (finished) return;
    finished = true;
    clearTimeout(timer);
    for (const animation of animations) animation.cancel();
    title.style.visibility = previousVisibility;
    opening.remove();
    delete root.dataset.opening;
    for (const event of ["pointerdown", "keydown", "wheel"])
      window.removeEventListener(event, finish, true);
    window.removeEventListener("resize", finish);
    window.removeEventListener("pagehide", finish);
    reduced.removeEventListener("change", finish);
  };
  timer = setTimeout(finish, duration);
  for (const event of ["pointerdown", "keydown", "wheel"])
    window.addEventListener(event, finish, { capture: true, passive: true });
  window.addEventListener("resize", finish);
  window.addEventListener("pagehide", finish);
  reduced.addEventListener("change", finish);
}
