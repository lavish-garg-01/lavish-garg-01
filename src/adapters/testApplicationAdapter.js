export class TestApplicationAdapter {
    constructor(page, baseUrl) {
        this.page = page;
        this.baseUrl = baseUrl;
    }

    canHandle(url) {
        return String(url).startsWith(this.baseUrl);
    }

    async open(application) {
        await this.page.goto(`${this.baseUrl}/test-job-form?applicationId=${encodeURIComponent(application.id)}`, {
            waitUntil: "domcontentloaded"
        });
    }

    async detectFields() {
        return this.page.locator("[data-application-field]").evaluateAll((elements) => elements.map((element) => {
            const label = document.querySelector(`label[for="${element.id}"]`)?.textContent?.trim() || element.name || element.id;
            return {
                id: element.id,
                label,
                type: element.type || element.tagName.toLowerCase(),
                required: element.required,
                options: element.tagName === "SELECT" ? [...element.options].map((option) => option.value).filter(Boolean) : []
            };
        }));
    }

    async fillField(field, answer) {
        const locator = this.page.locator(`#${field.id}`);
        if (field.type === "checkbox") {
            if (/^(yes|true|1)$/i.test(answer)) await locator.check();
            else await locator.uncheck();
        } else if (field.type === "select-one" || field.type === "select") {
            await locator.selectOption({ label: answer }).catch(() => locator.selectOption(answer));
        } else {
            await locator.fill(String(answer));
        }
    }

    async uploadResume(filePath) {
        await this.page.locator("#resume").setInputFiles(filePath);
    }

    async validate() {
        return this.page.locator("[data-application-field]").evaluateAll((elements) => {
            const missing = elements.filter((element) => element.required && !element.value).map((element) => element.id);
            return { valid: missing.length === 0, missing };
        });
    }

    async hasNextStep() {
        return false;
    }

    async submit() {
        await this.page.locator("#testSubmit").click();
        await this.page.waitForLoadState("domcontentloaded");
        return { submitted: true };
    }

    async verifySubmission() {
        const confirmation = this.page.locator("[data-application-success]");
        return {
            verified: await confirmation.count() > 0,
            confirmationText: await confirmation.textContent().catch(() => "")
        };
    }
}
