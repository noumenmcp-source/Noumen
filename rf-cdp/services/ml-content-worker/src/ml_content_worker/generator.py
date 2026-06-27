from .validator import Validator


class EmailGenerator:
    """Generates content variants via the LLM fleet and keeps only those that pass the
    standalone quality gate (Validator). Single source of truth for validation."""

    def __init__(self, flot_client, validator: Validator | None = None):
        self.flot_client = flot_client
        self.validator = validator or Validator()

    def generate_and_validate(self, brief, traits, num_variants):
        variants = self.flot_client.generate_variants(brief, traits, num_variants)
        valid = []
        for variant in variants:
            subject = variant.get("subject", "")
            body = variant.get("body", "")
            ok, reasons = self.validator.validate_variant(subject, body)
            if ok:
                valid.append(variant)
            else:
                variant["rejected_reasons"] = reasons
        return valid
