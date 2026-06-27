import click
from .run import run


@click.command()
@click.option('--campaign-id', required=True, type=str, help='The ID of the marketing campaign.')
@click.option('--segment-id', required=True, type=str, help='The ID of the segment to process.')
@click.option('--variants', required=True, type=int, help='Number of variants to generate per segment.')
def main(campaign_id: str, segment_id: str, variants: int):
    run(campaign_id, segment_id, variants)


if __name__ == '__main__':
    main()