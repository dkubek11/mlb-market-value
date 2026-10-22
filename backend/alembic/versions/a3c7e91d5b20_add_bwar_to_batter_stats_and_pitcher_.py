"""add bWAR to batter_stats and pitcher_stats

Revision ID: a3c7e91d5b20
Revises: b90b16934eee
Create Date: 2026-10-22 12:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a3c7e91d5b20'
down_revision: Union[str, Sequence[str], None] = 'b90b16934eee'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('batter_stats', sa.Column('bwar', sa.Numeric(precision=5, scale=2), nullable=True))
    op.add_column('pitcher_stats', sa.Column('bwar', sa.Numeric(precision=5, scale=2), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('pitcher_stats', 'bwar')
    op.drop_column('batter_stats', 'bwar')
