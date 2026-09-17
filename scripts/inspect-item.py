"""Print an item's recorded fields, tooltip, effects and measured scaling rows."""
from pathlib import Path
import argparse, json, sqlite3

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('item_id', type=int)
parser.add_argument('--data', default='data')
args = parser.parse_args()
root = Path(args.data).resolve()

def connect(name):
    db = sqlite3.connect((root / name).as_uri() + '?mode=ro', uri=True)
    db.row_factory = sqlite3.Row
    return db

game = connect('game.db')
helpers = connect('community-game.db')
row = game.execute('SELECT * FROM aowow_items WHERE id=?', (args.item_id,)).fetchone()
if row is None:
    raise SystemExit(f'Item {args.item_id} is absent from this snapshot')
tooltip = helpers.execute('SELECT * FROM item_tooltips WHERE item_id=?', (args.item_id,)).fetchone()
effects = helpers.execute('SELECT * FROM item_tooltip_effects WHERE item_id=? ORDER BY effect_index', (args.item_id,)).fetchall()
scaling = json.loads(Path('data/scaling/scaledump-results.json').read_text(encoding='utf-8'))
result = {'item': dict(row), 'tooltip': dict(tooltip) if tooltip else None, 'effects': [dict(effect) for effect in effects], 'measuredScaling': scaling['items'].get(str(args.item_id)), 'scalingSchema': scaling['schema']}
print(json.dumps(result, indent=2, ensure_ascii=False))
game.close()
helpers.close()
