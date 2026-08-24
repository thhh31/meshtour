export const controlTooltipStyles = `
.meshtour-control-tooltip {
  position: relative;
}
.meshtour-control-tooltip::before,
.meshtour-control-tooltip::after {
  position: absolute;
  left: 50%;
  z-index: 100;
  pointer-events: none;
  opacity: 0;
  transform: translate(-50%, 5px) scale(.96);
  transform-origin: 50% 100%;
  transition: opacity 150ms ease, transform 220ms cubic-bezier(.22,1,.36,1);
}
.meshtour-control-tooltip:not([data-tooltip])::before,
.meshtour-control-tooltip:not([data-tooltip])::after {
  display: none;
}
.meshtour-control-tooltip::before {
  content: attr(data-tooltip);
  bottom: calc(100% + 10px);
  width: max-content;
  max-width: min(240px, calc(100vw - 24px));
  box-sizing: border-box;
  padding: 7px 10px;
  border: 1px solid rgba(255,255,255,.12);
  border-radius: 7px;
  color: rgba(255,255,255,.96);
  background: rgba(20,20,22,.92);
  box-shadow: 0 8px 24px rgba(0,0,0,.34);
  backdrop-filter: blur(12px) saturate(125%);
  -webkit-backdrop-filter: blur(12px) saturate(125%);
  font: 500 12px/1.25 system-ui, sans-serif;
  letter-spacing: 0;
  text-align: center;
  white-space: normal;
}
.meshtour-control-tooltip::after {
  content: "";
  bottom: calc(100% + 5px);
  width: 9px;
  height: 9px;
  border-right: 1px solid rgba(255,255,255,.12);
  border-bottom: 1px solid rgba(255,255,255,.12);
  background: rgba(20,20,22,.92);
  rotate: 45deg;
}
.meshtour-control-tooltip:hover::before,
.meshtour-control-tooltip:hover::after,
.meshtour-control-tooltip:focus-visible::before,
.meshtour-control-tooltip:focus-visible::after {
  opacity: 1;
  transform: translate(-50%, 0) scale(1);
}
.meshtour-control-tooltip[data-tooltip-align="start"]::before {
  left: 0;
  transform: translate(0, 5px) scale(.96);
  transform-origin: 0 100%;
}
.meshtour-control-tooltip[data-tooltip-align="end"]::before,
.meshtour-spatial-toolbar > .meshtour-control-tooltip:last-child::before {
  right: 0;
  left: auto;
  transform: translate(0, 5px) scale(.96);
  transform-origin: 100% 100%;
}
.meshtour-control-tooltip[data-tooltip-align="start"]:hover::before,
.meshtour-control-tooltip[data-tooltip-align="start"]:focus-visible::before,
.meshtour-control-tooltip[data-tooltip-align="end"]:hover::before,
.meshtour-control-tooltip[data-tooltip-align="end"]:focus-visible::before,
.meshtour-spatial-toolbar > .meshtour-control-tooltip:last-child:hover::before,
.meshtour-spatial-toolbar > .meshtour-control-tooltip:last-child:focus-visible::before {
  transform: translate(0, 0) scale(1);
}
@media (prefers-reduced-motion: reduce) {
  .meshtour-control-tooltip::before,
  .meshtour-control-tooltip::after { transition-duration: .01ms; }
}
`;
