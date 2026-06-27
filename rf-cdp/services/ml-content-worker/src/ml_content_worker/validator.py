class Validator:
    BANNED_SPAM_WORDS = {"spam", "advertisement", "clickbait"}  # Example banned words

    def validate_subject(self, subject: str) -> bool:
        return 20 <= len(subject) <= 90

    def validate_body(self, body: str) -> bool:
        if not body:
            return False
        return not any(word in body.lower() for word in self.BANNED_SPAM_WORDS)

    def validate_links(self, content: str) -> bool:
        import re
        links = re.findall(r'href=["\'](http[s]?://[^"\']+)["\']', content)
        return all(link.startswith(('http://', 'https://')) for link in links)

    def validate_merge_tags(self, content: str) -> bool:
        return content.count('{{') == content.count('}}')

    def validate_variant(self, subject: str, body: str):
        reasons = []
        if not self.validate_subject(subject):
            reasons.append("Invalid subject length.")
        if not self.validate_body(body):
            reasons.append("Body contains banned spam words or is empty.")
        if not self.validate_merge_tags(body):
            reasons.append("Unbalanced merge tags.")
        return (len(reasons) == 0, reasons)