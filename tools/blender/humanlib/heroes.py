"""
The bodies every hero wears: one per gender and size class, all on one proxy, so all twelve share one surface. A hero's
physique moves its body along the morphs below, and everything a hero wears, hair and beards included, is a wardrobe
item bound over that surface in the game (tools/blender/wardrobe.py, src/kit/wear/). The demo roster's real people are
looks made of the same parts (src/arena/demo/looks.ts).
"""


def age(years):
    """MPFB's age macro: 0.5 is 25 years, 1.0 is 90."""
    return min(1.0, 0.5 + 0.5 * (years - 25) / 65) if years >= 25 else 0.1875 + 0.3125 * (years - 1) / 24


# Every body is built on the same proxy, so all twelve share one surface: the same vertices in the same order. Anything
# made for one body (a kimono, a haircut, a hat) binds to that surface once and fits them all (src/kit/wear/).
BODY_PROXY = 'female1605'

# The physique a player sets on any body, as morph targets: each is the body rebuilt with one macro moved to its end,
# minus the body itself (build.py). Weight and muscle go both ways from the body's own; age only ages.
MORPHS = [
    ('weight-', dict(weight=0.0)),
    ('weight+', dict(weight=1.0)),
    ('muscle-', dict(muscle=0.0)),
    ('muscle+', dict(muscle=1.0)),
    ('age', dict(age=age(75))),
]


def base(macro, height, portrait, **more):
    """A body: skin, a face and a painted base layer. Clothes, hair and beards are wardrobe items worn over it."""
    out = dict(macro=macro, height=height, portrait=portrait, proxy=BODY_PROXY)
    out.update(more)
    return out


# ------------------------------------------------------------------------------------------------ a body per size

# MakeHuman macros per size class. Every body is drawn at the same 1.8 m nominal height, so the game's size scale alone
# sets how big a hero is, and with it the hitbox (R23); the macros give each class the proportions that read as that
# size: a compact tiny build with a bigger head, an agile small one, an athletic medium, a broad large, a brawler's huge,
# and a titan for the colossal transformation. Tiny is a compact adult, never a child (the content floor).
SIZE_SHAPES = {
    'tiny': dict(height=0.12, weight=0.55, muscle=0.6, proportions=0.25, head=1.14),
    'small': dict(height=0.32, weight=0.42, muscle=0.6, proportions=0.45, head=1.1),
    'medium': dict(height=0.5, weight=0.5, muscle=0.75, proportions=0.6, head=1.08),
    'large': dict(height=0.72, weight=0.68, muscle=0.88, proportions=0.75, head=1.05),
    'huge': dict(height=0.9, weight=0.84, muscle=0.98, proportions=0.85, head=1.02, arms_out=10),
    'colossal': dict(height=1.0, weight=0.95, muscle=1.0, proportions=1.0, head=0.98, arms_out=14),
}

# the skin is tinted per hero, so the base head takes an even mix rather than any one ancestry's features
EVEN = dict(asian=0.34, caucasian=0.33, african=0.33)


def body_spec(gender, size):
    sh = SIZE_SHAPES[size]
    macro = dict(race=dict(EVEN), gender=1.0 if gender == 'm' else 0.0, age=age(28), muscle=sh['muscle'], weight=sh['weight'], height=sh['height'], proportions=sh['proportions'])
    more = dict(head_scale=sh['head'])
    if 'arms_out' in sh:
        more['arms_out'] = sh['arms_out']
    return base(macro, 1.8, 'base_male' if gender == 'm' else 'base_female', **more)


# m-tiny … f-colossal: the bodies every hero wears (character-look.ts picks one by gender and size)
BODIES = {f'{g}-{size}': body_spec(g, size) for g in ('m', 'f') for size in SIZE_SHAPES}


def spec(key):
    if key not in BODIES:
        raise KeyError(f'no body called {key!r}')
    return dict(BODIES[key], id=key)
