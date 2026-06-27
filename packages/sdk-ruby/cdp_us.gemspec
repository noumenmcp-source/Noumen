# frozen_string_literal: true

Gem::Specification.new do |spec|
  spec.name = "cdp_us"
  spec.version = "0.0.0"
  spec.summary = "Server-side Ruby ingestion SDK for CDP-US"
  spec.authors = ["Noumen"]
  spec.files = Dir["lib/**/*.rb"]
  spec.require_paths = ["lib"]
  spec.required_ruby_version = ">= 3.0"
  spec.add_development_dependency "rspec", "~> 3.13"
end
