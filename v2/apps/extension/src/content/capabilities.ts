import { capabilitiesForControl,type FieldCapability } from "@job-hunter-v2/contracts";

export function detectFieldCapabilities(element: HTMLElement): FieldCapability[] {
  return capabilitiesForControl({tagName:element.tagName,type:element instanceof HTMLInputElement?element.type:element.getAttribute("type"),role:element.getAttribute("role"),contentEditable:element.isContentEditable,multiple:element instanceof HTMLSelectElement&&element.multiple,ariaAutocomplete:element.hasAttribute("aria-autocomplete")});
}
