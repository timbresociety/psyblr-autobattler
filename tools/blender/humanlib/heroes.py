"""
Who each character is: the demo roster's real people (body macros, hair, signature outfit over battle gear, the
portrait their face comes from) and the generic bodies every other hero wears. Colours are sRGB. The hero's own suit
colour (heroHue in the game) is applied at runtime to the 'accent' pieces, so it stays the hero's identity colour,
and each role brings its arena kit: tanks plate up, fighters wear a cape, assassins travel light.
"""

# ------------------------------------------------------------------------------------------------ helpers


def black(v=0.055):
    return (v, v, v * 1.06)


def asian(**k):
    return dict(race=dict(asian=1.0, caucasian=0.0, african=0.0), **k)


def caucasian(**k):
    return dict(race=dict(asian=0.0, caucasian=1.0, african=0.0), **k)


def african(**k):
    return dict(race=dict(asian=0.0, caucasian=0.0, african=1.0), **k)


def south_asian(**k):
    return dict(race=dict(asian=0.35, caucasian=0.45, african=0.2), **k)


def age(years):
    """MPFB's age macro: 0.5 is 25 years, 1.0 is 90."""
    return min(1.0, 0.5 + 0.5 * (years - 25) / 65) if years >= 25 else 0.1875 + 0.3125 * (years - 1) / 24


BRONZE = dict(paint='metal', color=(0.74, 0.52, 0.27))
STEEL = dict(paint='metal', color=(0.62, 0.63, 0.66))
STRAP = dict(paint='leather', color=(0.26, 0.15, 0.08))
ACCENT = dict(paint='fabric', tint=True, region='suit')


def mats(**extra):
    base = {
        'bronze': BRONZE,
        'steel': STEEL,
        'strap': STRAP,
        'accent': ACCENT,
        'belt': dict(paint='leather', color=(0.2, 0.12, 0.07)),
        'glasses': dict(paint='flat', color=black(0.08)),
        'hat': dict(paint='fabric', color=black(0.05)),
        'cigar': dict(paint='leather', color=(0.36, 0.22, 0.12)),
    }
    base.update(extra)
    return base


# role kits: battle gear over the signature outfit ------------------------------------------------------------------


def kit(role, metal='bronze', accent='sash', side='L'):
    out = {
        'tank': [('pauldron', dict(side='L', mat=metal, layers=2, size=0.15)), ('pauldron', dict(side='R', mat=metal, layers=2, size=0.15)), ('greaves', dict(mat=metal)), ('bracers', dict(mat='strap')), ('belt', dict(mat='belt', buckle=metal))],
        'fighter': [('pauldron', dict(side=side, mat=metal, layers=2)), ('bracers', dict(mat='strap')), ('belt', dict(mat='belt', buckle=metal))],
        'assassin': [('bracers', dict(mat='strap', start=0.35)), ('belt', dict(mat='belt', buckle=metal))],
        'mage': [('bracers', dict(mat=metal, start=0.62, end=0.9))],
        'marksman': [('pauldron', dict(side=side, mat=metal, layers=2, size=0.12)), ('bracers', dict(mat='strap')), ('belt', dict(mat='belt', buckle=metal))],
        'support': [('pauldron', dict(side=side, mat=metal, layers=1, size=0.12)), ('belt', dict(mat='belt', buckle=metal))],
        'controller': [('bracers', dict(mat=metal, start=0.55, end=0.9)), ('belt', dict(mat='belt', buckle=metal))],
        'summoner': [('bracers', dict(mat='strap', start=0.5)), ('belt', dict(mat='belt', buckle=metal))],
    }[role]
    if accent == 'sash':
        out.append(('sash', dict(mat='accent', side='R' if side == 'L' else 'L')))
    elif accent == 'cape':
        out.append(('cape', dict(mat='accent')))
    return out


# outfits ------------------------------------------------------------------------------------------------------------


def suit(jacket='jacket', shirt='shirt', trousers='trousers', shoes='shoes', tie=None, bowtie=None, hem='hip', open='v', thick=0.014, collar=True, lapels=True, vest=None):
    """A tailored suit: shirt, optional waistcoat, an open jacket with lapels, a tie or bow tie, trousers and shoes."""
    # inside out: the shirt tucks into the trousers, the jacket hangs over both
    layers = [dict(kind='tee', mat=shirt, sleeve=1.95, hem='hip', neck='collar', thick=0.004), dict(kind='trousers', mat=trousers, thick=0.01, flare=0.008)]
    if vest:
        layers.append(dict(kind='vest', mat=vest, sleeve=0, hem='hip', neck='v', thick=0.008))
    layers += [
        dict(kind='jacket', mat=jacket, sleeve=1.92, hem=hem, neck='collar', open=open, open_width=0.07, thick=thick, pad=0.012),
        dict(kind='shoes', mat=shoes, thick=0.013),
    ]
    gear = []
    if collar:
        gear.append(('collar', dict(mat=shirt, height=0.035, gap=0.16, offset=0.006)))
    if tie:
        gear.append(('tie', dict(mat=tie)))
    if bowtie:
        gear.append(('bowtie', dict(mat=bowtie)))
    if lapels and open:
        gear.append(('lapels', dict(mat=jacket)))
    gear += [('hem', dict(mat=jacket, at=hem, offset=thick + 0.006)), ('trouser_hems', dict(mat=trousers))]
    return layers, gear


def casual(top='tee', top_kind='tee', sleeve=0.5, neck='crew', jacket=None, jacket_open='v', trousers='trousers', shoes='shoes', thick=0.005, jacket_collar=True):
    # inside out: an untucked top hangs over the trousers, a jacket over the top
    layers = [dict(kind='trousers', mat=trousers, thick=0.01, flare=0.01), dict(kind=top_kind, mat=top, sleeve=sleeve, hem='hip', neck=neck, thick=thick)]
    gear = []
    if jacket:
        layers.append(dict(kind='jacket', mat=jacket, sleeve=1.93, hem='hip', neck='collar', open=jacket_open, open_width=0.07, thick=0.016, pad=0.01))
        if jacket_collar:
            gear.append(('collar', dict(mat=jacket, height=0.045, gap=0.24, offset=0.012)))
        gear.append(('hem', dict(mat=jacket, at='hip', offset=0.022)))
    layers.append(dict(kind='shoes', mat=shoes, thick=0.013))
    gear.append(('trouser_hems', dict(mat=trousers)))
    return layers, gear


def hero(name, portrait, macro, height, hair, outfit, role, materials, accent='sash', side='L', metal='bronze', beard=None, extra_gear=(), **more):
    layers, gear = outfit
    out = dict(
        name=name,
        portrait=portrait,
        macro=macro,
        height=height,
        hair=hair,
        layers=layers,
        gear=gear + kit(role, metal, accent, side) + list(extra_gear),
        mats=mats(**materials),
        smooth=[l['mat'] for l in layers if l['kind'] in ('jacket', 'vest')],
    )
    if beard:
        out['beard'] = beard
    out.update(more)
    return out


NAVY = (0.09, 0.11, 0.2)
CHARCOAL = (0.16, 0.16, 0.18)
WHITE_SHIRT = (0.9, 0.9, 0.92)
BLUE_SHIRT = (0.62, 0.74, 0.88)
DENIM = (0.17, 0.24, 0.38)


def hair_mat(color, color2):
    return dict(paint='hair', color=color, color2=color2)


HEROES = {
    'musk': hero(
        'Elon "Starship" Musk', 'musk', caucasian(gender=1.0, age=age(54), muscle=0.45, weight=0.62), 1.86,
        dict(style='short', recede=0.01, mat='hair'),
        casual(top='tee', jacket='jacket'), 'mage',
        dict(tee=dict(paint='cotton', color=black(0.05)), jacket=dict(paint='fabric', color=(0.1, 0.1, 0.12)), trousers=dict(paint='denim', color=(0.09, 0.09, 0.11)), shoes=dict(paint='leather', color=black(0.05)), hair=hair_mat((0.2, 0.13, 0.08), (0.32, 0.22, 0.14))),
        accent='cape', arms_out=4,
    ),
    'huang': hero(
        'Jensen "CUDA Core" Huang', 'huang', asian(gender=1.0, age=age(61), muscle=0.5, weight=0.5, proportions=0.55), 1.75,
        dict(style='swept', recede=0.006, temple=0.006, mat='hair'),
        casual(top='tee', jacket='jacket'), 'marksman',
        dict(tee=dict(paint='cotton', color=black(0.05)), jacket=dict(paint='leather', color=black(0.065)), trousers=dict(paint='denim', color=(0.07, 0.07, 0.08)), shoes=dict(paint='leather', color=black(0.045)), hair=hair_mat((0.05, 0.05, 0.055), (0.42, 0.42, 0.45))),
    ),
    'bezos': hero(
        'Jeff "Prime" Bezos', 'bezos', caucasian(gender=1.0, age=age(61), muscle=0.78, weight=0.55), 1.74,
        None,
        casual(top='shirt', top_kind='tee', sleeve=1.6, neck='collar'), 'tank',
        dict(shirt=dict(paint='cotton', color=BLUE_SHIRT), trousers=dict(paint='fabric', color=NAVY), shoes=dict(paint='leather', color=(0.3, 0.18, 0.1))),
        extra_gear=[('collar', dict(mat='shirt', height=0.03, gap=0.18, offset=0.006))], arms_out=8,
    ),
    'zuckerberg': hero(
        'Mark "Metaverse" Zuckerberg', 'zuckerberg', caucasian(gender=1.0, age=age(41), muscle=0.6, weight=0.45), 1.71,
        dict(style='curly', mat='hair'),
        casual(top='tee'), 'assassin',
        dict(tee=dict(paint='cotton', color=(0.46, 0.47, 0.5)), trousers=dict(paint='denim', color=DENIM), shoes=dict(paint='leather', color=(0.75, 0.75, 0.76)), hair=hair_mat((0.3, 0.19, 0.11), (0.42, 0.28, 0.16))),
    ),
    'nadella': hero(
        'Satya "Copilot" Nadella', 'nadella', south_asian(gender=1.0, age=age(58), muscle=0.4, weight=0.5), 1.73,
        dict(style='thin', mat='hair'),
        suit(), 'support',
        dict(jacket=dict(paint='wool', color=NAVY), shirt=dict(paint='cotton', color=BLUE_SHIRT), trousers=dict(paint='wool', color=CHARCOAL), shoes=dict(paint='leather', color=black(0.06)), hair=hair_mat((0.32, 0.31, 0.3), (0.55, 0.55, 0.55)), glasses=dict(paint='metal', color=(0.7, 0.7, 0.72))),
        extra_gear=[('glasses', dict(shape='rect'))],
    ),
    'altman': hero(
        'Sam "AGI" Altman', 'altman', caucasian(gender=1.0, age=age(40), muscle=0.4, weight=0.4), 1.70,
        dict(style='short', mat='hair'),
        casual(top='sweater', sleeve=1.93, thick=0.009), 'controller',
        dict(sweater=dict(paint='knit', color=(0.36, 0.38, 0.42)), trousers=dict(paint='denim', color=DENIM), shoes=dict(paint='leather', color=(0.82, 0.82, 0.8)), hair=hair_mat((0.2, 0.14, 0.09), (0.3, 0.21, 0.14))),
    ),
    'buffett': hero(
        'Warren "Oracle" Buffett', 'buffett', caucasian(gender=1.0, age=age(90), muscle=0.3, weight=0.62), 1.76,
        dict(style='fringe_white', recede=0.02, temple=0.01, mat='hair'),
        suit(tie='tie'), 'summoner',
        dict(jacket=dict(paint='wool', color=(0.33, 0.34, 0.37)), shirt=dict(paint='cotton', color=WHITE_SHIRT), tie=dict(paint='silk', color=(0.5, 0.1, 0.12)), trousers=dict(paint='wool', color=(0.3, 0.31, 0.34)), shoes=dict(paint='leather', color=black(0.06)), hair=hair_mat((0.86, 0.86, 0.84), (0.7, 0.7, 0.7))),
        extra_gear=[('glasses', dict(shape='round'))], accent='cape',
    ),
    'winfrey': hero(
        'Oprah "You Get One" Winfrey', 'winfrey', african(gender=0.0, age=age(71), muscle=0.4, weight=0.66), 1.69,
        dict(style='volume', recede=-0.004, mat='hair'),
        suit(shirt='top', collar=False), 'fighter',
        dict(jacket=dict(paint='fabric', color=(0.36, 0.1, 0.36)), top=dict(paint='silk', color=(0.12, 0.05, 0.12)), trousers=dict(paint='fabric', color=(0.12, 0.06, 0.12)), shoes=dict(paint='leather', color=black(0.06)), hair=hair_mat((0.12, 0.07, 0.05), (0.26, 0.15, 0.09))),
        accent='cape', side='R',
    ),
    'ambani': hero(
        'Mukesh "Jio" Ambani', 'ambani', south_asian(gender=1.0, age=age(67), muscle=0.35, weight=0.76), 1.73,
        dict(style='swept', recede=0.012, mat='hair'),
        suit(), 'tank',
        dict(jacket=dict(paint='wool', color=(0.11, 0.12, 0.17)), shirt=dict(paint='cotton', color=WHITE_SHIRT), trousers=dict(paint='wool', color=black(0.08)), shoes=dict(paint='leather', color=black(0.05)), hair=hair_mat(black(0.04), (0.15, 0.13, 0.12))),
        arms_out=8,
    ),
    'su': hero(
        'Lisa "Zen Core" Su', 'su', asian(gender=0.0, age=age(55), muscle=0.45, weight=0.45), 1.60,
        dict(style='swept', mat='hair'),
        suit(shirt='top', collar=False), 'assassin',
        dict(jacket=dict(paint='fabric', color=(0.55, 0.08, 0.1)), top=dict(paint='silk', color=black(0.06)), trousers=dict(paint='fabric', color=black(0.07)), shoes=dict(paint='leather', color=black(0.05)), hair=hair_mat(black(0.035), (0.2, 0.2, 0.21)), glasses=dict(paint='metal', color=(0.62, 0.6, 0.58))),
        extra_gear=[('glasses', dict(shape='rect'))],
    ),
    'lincoln': hero(
        'Abraham "Honest Axe" Lincoln', 'lincoln', caucasian(gender=1.0, age=age(56), muscle=0.45, weight=0.3, proportions=0.6), 1.93,
        dict(style='unkempt', mat='hair'),
        suit(jacket='coat', bowtie='bowtie', hem='thigh', thick=0.016), 'fighter',
        dict(coat=dict(paint='wool', color=black(0.06)), shirt=dict(paint='cotton', color=WHITE_SHIRT), bowtie=dict(paint='silk', color=black(0.04)), trousers=dict(paint='wool', color=black(0.07)), shoes=dict(paint='leather', color=black(0.05)), hair=hair_mat((0.08, 0.06, 0.05), (0.15, 0.11, 0.08)), beard=hair_mat((0.08, 0.06, 0.05), (0.14, 0.1, 0.07))),
        beard='chin_curtain', accent='cape', extra_gear=[('top_hat', dict())],
    ),
    'churchill': hero(
        'Winston "Bulldog" Churchill', 'churchill', caucasian(gender=1.0, age=age(68), muscle=0.35, weight=0.88), 1.68,
        dict(style='thin', mat='hair'),
        suit(bowtie='bowtie', vest='vest'), 'tank',
        dict(jacket=dict(paint='wool', color=(0.1, 0.1, 0.12)), vest=dict(paint='wool', color=(0.12, 0.12, 0.14)), shirt=dict(paint='cotton', color=WHITE_SHIRT), bowtie=dict(paint='dots', color=(0.07, 0.1, 0.3), color2=(0.92, 0.92, 0.9)), trousers=dict(paint='wool', color=(0.12, 0.12, 0.14)), shoes=dict(paint='leather', color=black(0.05)), hair=hair_mat((0.72, 0.62, 0.5), (0.6, 0.52, 0.44))),
        extra_gear=[('cigar', dict())], arms_out=12,
    ),
    'obama': hero(
        'Barack "Hope Beam" Obama', 'obama', african(gender=1.0, age=age(64), muscle=0.5, weight=0.4), 1.85,
        dict(style='buzz', recede=0.008, mat='hair'),
        suit(tie='tie'), 'marksman',
        dict(jacket=dict(paint='wool', color=(0.08, 0.1, 0.18)), shirt=dict(paint='cotton', color=WHITE_SHIRT), tie=dict(paint='silk', color=(0.32, 0.5, 0.75)), trousers=dict(paint='wool', color=(0.08, 0.1, 0.18)), shoes=dict(paint='leather', color=black(0.05)), hair=hair_mat((0.1, 0.09, 0.09), (0.45, 0.45, 0.45))),
    ),
    'trump': hero(
        'Donald "Dealmaker" Trump', 'trump', caucasian(gender=1.0, age=age(79), muscle=0.4, weight=0.72), 1.90,
        dict(style='quiff', recede=-0.004, mat='hair'),
        suit(tie='tie'), 'fighter',
        dict(jacket=dict(paint='wool', color=(0.07, 0.09, 0.17)), shirt=dict(paint='cotton', color=WHITE_SHIRT), tie=dict(paint='silk', color=(0.72, 0.06, 0.08)), trousers=dict(paint='wool', color=(0.07, 0.09, 0.17)), shoes=dict(paint='leather', color=black(0.05)), hair=hair_mat((0.86, 0.72, 0.42), (0.95, 0.85, 0.6))),
        accent='cape', arms_out=8,
    ),
    'modi': hero(
        'Narendra "Saffron Storm" Modi', 'modi', south_asian(gender=1.0, age=age(75), muscle=0.35, weight=0.6), 1.70,
        dict(style='fringe_white', recede=0.014, mat='hair'),
        (
            [dict(kind='trousers', mat='trousers', thick=0.006), dict(kind='kurta', mat='kurta', sleeve=1.9, hem='knee', neck='mandarin', thick=0.008), dict(kind='vest', mat='accent', sleeve=0, hem='hip', neck='mandarin', thick=0.014), dict(kind='shoes', mat='shoes', thick=0.012)],
            [('collar', dict(mat='accent', height=0.03, gap=0.1, offset=0.008)), ('hem', dict(mat='kurta', at='thigh', offset=0.012))],
        ),
        'mage',
        dict(kurta=dict(paint='cotton', color=(0.93, 0.9, 0.84)), trousers=dict(paint='cotton', color=(0.92, 0.9, 0.85)), shoes=dict(paint='leather', color=(0.3, 0.18, 0.1)), hair=hair_mat((0.9, 0.9, 0.88), (0.75, 0.75, 0.74)), beard=hair_mat((0.92, 0.92, 0.9), (0.76, 0.76, 0.75)), glasses=dict(paint='metal', color=(0.78, 0.66, 0.4))),
        beard='full', accent=None, extra_gear=[('glasses', dict(shape='rect'))],
    ),
    'merkel': hero(
        'Angela "Iron Chancellor" Merkel', 'merkel', caucasian(gender=0.0, age=age(71), muscle=0.35, weight=0.62), 1.65,
        dict(style='bob', mat='hair'),
        suit(jacket='accent', shirt='top', collar=False, lapels=False), 'controller',
        dict(top=dict(paint='silk', color=black(0.06)), trousers=dict(paint='fabric', color=black(0.07)), shoes=dict(paint='leather', color=black(0.05)), hair=hair_mat((0.78, 0.66, 0.46), (0.88, 0.8, 0.62))),
        accent=None,
    ),
    'macron': hero(
        'Emmanuel "Jupiter" Macron', 'macron', caucasian(gender=1.0, age=age(47), muscle=0.45, weight=0.4), 1.73,
        dict(style='side_part', recede=0.008, mat='hair'),
        suit(tie='tie'), 'assassin',
        dict(jacket=dict(paint='wool', color=(0.06, 0.08, 0.16)), shirt=dict(paint='cotton', color=WHITE_SHIRT), tie=dict(paint='silk', color=(0.05, 0.07, 0.14)), trousers=dict(paint='wool', color=(0.06, 0.08, 0.16)), shoes=dict(paint='leather', color=black(0.05)), hair=hair_mat((0.17, 0.12, 0.09), (0.38, 0.33, 0.3))),
    ),
    'zelenskyy': hero(
        'Volodymyr "Kyiv Shield" Zelenskyy', 'zelenskyy', caucasian(gender=1.0, age=age(47), muscle=0.62, weight=0.55), 1.70,
        dict(style='crop', recede=0.004, mat='hair'),
        casual(top='tee', sleeve=1.9, thick=0.008, shoes='boots'), 'tank',
        dict(tee=dict(paint='cotton', color=(0.27, 0.3, 0.2)), trousers=dict(paint='fabric', color=(0.23, 0.25, 0.18)), boots=dict(paint='leather', color=(0.15, 0.12, 0.09)), hair=hair_mat((0.17, 0.13, 0.1), (0.26, 0.2, 0.15)), beard=hair_mat((0.16, 0.12, 0.09), (0.24, 0.18, 0.13))),
        metal='steel', beard=('full', 0.005),
    ),
    'ardern': hero(
        'Jacinda "Kindness Wave" Ardern', 'ardern', caucasian(gender=0.0, age=age(45), muscle=0.45, weight=0.5), 1.70,
        dict(style='long', mat='hair'),
        suit(jacket='coat', shirt='top', collar=False, hem='thigh'), 'support',
        dict(coat=dict(paint='wool', color=(0.08, 0.09, 0.12)), top=dict(paint='silk', color=(0.85, 0.83, 0.8)), trousers=dict(paint='fabric', color=black(0.07)), shoes=dict(paint='leather', color=black(0.05)), hair=hair_mat((0.24, 0.15, 0.09), (0.36, 0.24, 0.14))),
    ),
    'yew': hero(
        'Lee Kuan "Miracle" Yew', 'yew', asian(gender=1.0, age=age(52), muscle=0.45, weight=0.42), 1.74,
        dict(style='side_part', recede=0.012, mat='hair'),
        casual(top='shirt', sleeve=0.55, neck='collar'), 'summoner',
        dict(shirt=dict(paint='cotton', color=(0.94, 0.94, 0.95)), trousers=dict(paint='cotton', color=(0.92, 0.92, 0.93)), shoes=dict(paint='leather', color=black(0.06)), hair=hair_mat((0.08, 0.08, 0.08), (0.3, 0.3, 0.3))),
        extra_gear=[('collar', dict(mat='shirt', height=0.03, gap=0.2, offset=0.006))], accent='cape',
    ),
}

# ------------------------------------------------------------------------------------------------ generic bodies

# Every region is tinted per hero at runtime (characterLook): suit, trim, pants, glove, boot, hair, metal, cape. Hair
# styles, the helmet, the armour and the cape are switchable parts.
BASE_MATS = {
    'suit': dict(paint='fabric', region='suit', tint=True),
    'trim': dict(paint='leather', region='trim', tint=True),
    'pants': dict(paint='fabric', region='pants', tint=True),
    'boot': dict(paint='leather', region='boot', tint=True),
    'glove': dict(paint='leather', region='glove', tint=True),
    'hair': dict(paint='hair', region='hair', tint=True, color=(1, 1, 1), color2=(0.72, 0.72, 0.72)),
    'metal': dict(paint='metal', region='metal', tint=True),
    'cape': dict(paint='fabric', region='cape', tint=True),
    'belt': dict(paint='leather', region='boot', tint=True),
    'strap': dict(paint='leather', region='trim', tint=True),
    'accent': dict(paint='fabric', region='trim', tint=True),
}


def base(macro, height, portrait, **more):
    layers = [
        dict(kind='trousers', mat='pants', thick=0.009, flare=0.004),
        dict(kind='tee', mat='suit', sleeve=0.55, hem='crotch', neck='crew', thick=0.006),
        dict(kind='boots', mat='boot', thick=0.012, top=0.6),
        dict(kind='gloves', mat='glove', thick=0.004, cuff=0.75),
    ]
    gear = [
        ('collar', dict(mat='trim', height=0.012, gap=0, offset=0.005, drop=0.04, name='neckband')),
        ('hem', dict(mat='suit', at='crotch', offset=0.014, flare=0.012)),
        ('belt', dict(mat='belt', buckle='metal')),
        ('bracers', dict(mat='strap', start=0.3, end=0.72)),
    ]
    out = dict(macro=macro, height=height, portrait=portrait, layers=layers, gear=gear, mats=dict(BASE_MATS), parts=True, smooth=['suit'])
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


# m-tiny … f-colossal: the bodies every hero without a model of its own wears (character-look.ts picks one)
BODIES = {f'{g}-{size}': body_spec(g, size) for g in ('m', 'f') for size in SIZE_SHAPES}


def spec(key):
    if key in HEROES:
        out = dict(HEROES[key])
    elif key in BODIES:
        out = dict(BODIES[key])
        out['base'] = True
    else:
        raise KeyError(f'no hero or body called {key!r}')
    out['id'] = key
    out.setdefault('proxy', 'male1591' if out['macro'].get('gender', 1.0) >= 0.5 else 'female1605')
    return out
