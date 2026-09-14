const FIELD_SELECTOR = [
    "input:not([type=hidden]):not([type=submit]):not([type=button]):not([type=image])",
    "textarea",
    "select"
].join(",");

function normalized(value = "") {
    return String(value).replace(/\s+/g, " ").trim();
}

export class RealApplicationAdapter {
    constructor(page) {
        this.page = page;
        this.form = null;
        this.controls = null;
    }

    canHandle(url) {
        return /^https?:\/\//i.test(String(url));
    }

    async open(application) {
        await this.page.goto(application.job_url, { waitUntil: "domcontentloaded", timeout: 60000 });
        await this.page.waitForTimeout(1000);
        if (!(await this.hasApplicationFields())) await this.openApplicationForm();
        await this.selectBestForm();
    }

    async hasApplicationFields() {
        if (await this.page.locator('input[type="file"]:visible').count()) return true;
        const forms = this.page.locator("form");
        for (let index = 0; index < await forms.count(); index += 1) {
            const form = forms.nth(index);
            const count = await form.locator(FIELD_SELECTOR).filter({ visible: true }).count();
            const identity = await form.locator('input[type="email"], input[name*="email" i], input[name*="first" i]').count();
            if (count >= 3 && identity > 0) return true;
        }
        return false;
    }

    async openApplicationForm() {
        const applyName = /^(?:easy )?apply(?: now| for this job| on company (?:site|website))?$/i;
        const apply = this.page.getByRole("link", { name: applyName }).or(
            this.page.getByRole("button", { name: applyName })
        ).first();
        if (!(await apply.count())) return;

        const popupPromise = this.page.context().waitForEvent("page", { timeout: 5000 }).catch(() => null);
        await apply.click();
        const popup = await popupPromise;
        if (popup) {
            this.page = popup;
            await popup.waitForLoadState("domcontentloaded", { timeout: 60000 }).catch(() => {});
        } else {
            await this.page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
        }
        await this.page.waitForTimeout(1000);
    }

    async selectBestForm() {
        const forms = this.page.locator('form, [role="dialog"]');
        let best = null;
        let bestCount = 0;
        for (let index = 0; index < await forms.count(); index += 1) {
            const candidate = forms.nth(index);
            const count = await candidate.locator(FIELD_SELECTOR).filter({ visible: true }).count();
            if (count > bestCount) {
                best = candidate;
                bestCount = count;
            }
        }
        this.form = best || this.page.locator("body");
        this.controls = this.form.locator(FIELD_SELECTOR).filter({ visible: true });
    }

    async pageState() {
        const body = normalized(await this.page.locator("body").innerText().catch(() => ""));
        return {
            captcha: /captcha|verify you are human|i'm not a robot|security challenge/i.test(body),
            login: /(?:sign|log) in to (?:apply|continue)|create an account to apply/i.test(body)
        };
    }

    async detectFields() {
        await this.selectBestForm();
        const elements = await this.controls.evaluateAll((controls) => controls.map((element, index) => {
            const id = element.id || "";
            const name = element.getAttribute("name") || "";
            const associated = id ? document.querySelector(`label[for="${CSS.escape(id)}"]`) : null;
            const wrapping = element.closest("label");
            const group = element.closest("fieldset, [role=group], .field, .application-question, .question");
            const groupLabel = group?.querySelector("legend, label, .label, [data-qa=label]");
            const label = [
                associated?.innerText,
                wrapping?.innerText,
                groupLabel?.innerText,
                element.getAttribute("aria-label"),
                element.getAttribute("placeholder"),
                name,
                id
            ].find((value) => String(value || "").trim()) || `Field ${index + 1}`;
            const type = element.tagName === "SELECT" ? "select-one" : element.tagName === "TEXTAREA" ? "textarea" : (element.getAttribute("type") || "text").toLowerCase();
            const options = element.tagName === "SELECT"
                ? [...element.options].map((option) => ({ value: option.value, label: option.textContent.trim() })).filter((option) => option.value || option.label)
                : [];
            return {
                index, id, name,
                label: label.replace(/\s+/g, " ").trim(),
                type,
                required: Boolean(element.required || element.getAttribute("aria-required") === "true"),
                value: type === "checkbox" || type === "radio" ? (element.checked ? element.value || "true" : "") : element.value || "",
                options
            };
        }));
        return elements.map((field) => ({
            ...field,
            id: `real:${field.id || field.name || "field"}:${field.label.toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40)}:${field.index}`
        }));
    }

    control(field) {
        return this.controls.nth(field.index);
    }

    async fillField(field, answer) {
        const locator = this.control(field);
        if (field.type === "checkbox") {
            if (/^(yes|true|1|agree|accepted)$/i.test(String(answer))) await locator.check();
            else await locator.uncheck();
        } else if (field.type === "radio") {
            const groupName = field.name;
            const radios = groupName ? this.form.locator(`input[type=radio][name="${groupName.replace(/"/g, '\\"')}"]`) : locator;
            let selected = false;
            for (let index = 0; index < await radios.count(); index += 1) {
                const radio = radios.nth(index);
                const value = await radio.getAttribute("value") || "";
                const id = await radio.getAttribute("id");
                const label = id ? await this.page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).textContent().catch(() => "") : "";
                if ([value, label].some((item) => normalized(item).toLowerCase() === normalized(answer).toLowerCase())) {
                    await radio.check();
                    selected = true;
                    break;
                }
            }
            if (!selected) throw new Error(`No radio option matches "${answer}" for ${field.label}.`);
        } else if (field.type === "select-one") {
            await locator.selectOption({ label: String(answer) }).catch(() => locator.selectOption(String(answer)));
        } else {
            await locator.fill(String(answer));
        }
    }

    async uploadResume(filePath) {
        await this.selectBestForm();
        const files = this.form.locator('input[type="file"]');
        if (!(await files.count())) return false;
        let target = files.first();
        for (let index = 0; index < await files.count(); index += 1) {
            const input = files.nth(index);
            const id = await input.getAttribute("id") || "";
            const name = await input.getAttribute("name") || "";
            const label = id ? await this.page.locator(`label[for="${id.replace(/"/g, '\\"')}"]`).textContent().catch(() => "") : "";
            if (/resume|cv/i.test(`${id} ${name} ${label}`)) { target = input; break; }
        }
        await target.setInputFiles(filePath);
        return true;
    }

    async validate() {
        const missing = await this.controls.evaluateAll((elements) => elements.flatMap((element, index) => {
            if (!(element.required || element.getAttribute("aria-required") === "true")) return [];
            return element.checkValidity() ? [] : [index];
        }));
        return { valid: missing.length === 0, missing: missing.map((index) => `field-${index + 1}`) };
    }

    async hasNextStep() {
        return await this.form.getByRole("button", { name: /^(?:save and )?(?:continue|next|review)(?: application)?$/i }).count() > 0;
    }

    async nextStep() {
        const button = this.form.getByRole("button", { name: /^(?:save and )?(?:continue|next|review)(?: application)?$/i }).first();
        await button.click();
        await this.page.waitForLoadState("domcontentloaded", { timeout: 30000 }).catch(() => {});
        await this.page.waitForTimeout(800);
        await this.selectBestForm();
    }

    async submit() {
        const submit = this.form.getByRole("button", { name: /^(?:submit|send)(?: my)? application$/i }).or(
            this.form.locator('button[type="submit"], input[type="submit"]')
        ).first();
        if (!(await submit.count())) throw new Error("A final application submit button was not found.");
        await submit.click();
        await this.page.waitForLoadState("domcontentloaded", { timeout: 45000 }).catch(() => {});
        await this.page.waitForTimeout(1000);
        return { submitted: true };
    }

    async verifySubmission() {
        const url = this.page.url();
        const body = normalized(await this.page.locator("body").innerText().catch(() => ""));
        const matched = body.match(/(?:application (?:has been )?(?:submitted|received)|thanks? for applying|thank you for (?:applying|your application)|we have received your application)/i);
        return {
            verified: Boolean(matched || /thank|success|confirmation/i.test(new URL(url).pathname)),
            confirmationText: matched?.[0] || "Application submission confirmation detected."
        };
    }
}
