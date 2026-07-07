"""add player_type to player_value primary key

Revision ID: d77ee9e7a03c
Revises: ef313b50121e
Create Date: 2026-07-07 18:43:12.002598

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'd77ee9e7a03c'
down_revision: Union[str, Sequence[str], None] = 'ef313b50121e'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column(
        'player_value',
        sa.Column(
            'player_type',
            sa.Enum('BATTER', 'PITCHER', name='player_type_enum'),
            nullable=False,
        ),
    )
    op.drop_constraint('player_value_pkey', 'player_value', type_='primary')
    op.create_primary_key(
        'player_value_pkey', 'player_value', ['player_id', 'season', 'player_type']
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('player_value_pkey', 'player_value', type_='primary')
    op.create_primary_key('player_value_pkey', 'player_value', ['player_id', 'season'])
    op.drop_column('player_value', 'player_type')
