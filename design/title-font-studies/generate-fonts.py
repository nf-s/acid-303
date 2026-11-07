"""Original five-letter display alphabets for the Grain title comparison.

Build with Python + fonttools + brotli + shapely. No source font is used.
All outline coordinates and constructions below were created for this project.
"""
from pathlib import Path
import json
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from shapely.geometry import Polygon, LineString, box
from shapely.ops import unary_union
from shapely.affinity import scale, translate
from shapely.geometry.polygon import orient

ROOT = Path(__file__).resolve().parent
FONTS = ROOT / "fonts"
FONTS.mkdir(exist_ok=True)


def p(points):
    return Polygon(points)


def stroke(points, width):
    return LineString(points).buffer(width / 2, cap_style="square", join_style="bevel")


def join(*shapes):
    return unary_union(shapes)


def cut(shape, *holes):
    return shape.difference(join(*holes))


def glyph(shape, width):
    return shape, width


def octagon(x, y, w, h, corner):
    return p([(x+corner,y),(x+w-corner,y),(x+w,y+corner),(x+w,y+h-corner),
              (x+w-corner,y+h),(x+corner,y+h),(x,y+h-corner),(x,y+corner)])


# 01: Low, extended octagonal rails, wide counters, deliberately narrow I.
extended = {
    "G": glyph(stroke([(880,145),(810,70),(150,70),(70,145),(70,555),(150,630),(830,630),(880,580),(880,365),(550,365)],135),950),
    "R": glyph(join(stroke([(70,630),(70,70),(800,70),(880,145),(880,285),(800,360),(70,360)],135),stroke([(540,360),(880,630)],135)),950),
    "A": glyph(join(stroke([(70,630),(270,70),(680,70),(880,630)],135),stroke([(160,420),(790,420)],115)),950),
    "I": glyph(join(box(35,0,365,125),box(135,125,265,575),box(35,575,365,700)),400),
    "N": glyph(stroke([(70,630),(70,70),(180,70),(770,630),(880,630),(880,70)],135),950),
}

# 02: Tall, compressed towers with deep straight-sided counters.
compressed = {
    "G": glyph(p([(75,0),(315,0),(375,65),(375,205),(245,205),(245,135),(130,135),(130,605),(245,605),(245,450),(185,450),(185,325),(375,325),(375,680),(310,745),(70,745),(0,675),(0,75)]),375),
    "R": glyph(cut(p([(0,0),(295,0),(380,75),(380,350),(295,420),(395,745),(245,745),(160,450),(135,450),(135,745),(0,745)]),box(135,130,245,320)),395),
    "A": glyph(cut(p([(105,0),(290,0),(405,745),(265,745),(245,565),(145,565),(125,745),(0,745)]),p([(190,180),(160,435),(230,435)])),405),
    "I": glyph(p([(0,0),(185,0),(185,110),(155,145),(155,600),(185,635),(185,745),(0,745),(0,635),(30,600),(30,145),(0,110)]),185),
    "N": glyph(p([(0,745),(0,0),(130,0),(255,420),(255,0),(385,0),(385,745),(250,745),(130,330),(130,745)]),385),
}

# 03: Disconnected stencil plates. The gaps are part of each glyph outline.
stencil = {
    "G": glyph(join(p([(115,0),(635,0),(635,155),(115,155),(45,85)]),box(0,120,155,565),p([(70,610),(155,550),(635,550),(635,700),(70,700)]),p([(395,310),(635,310),(635,520),(480,520),(480,445),(395,445)])),635),
    "R": glyph(join(box(0,0,145,320),box(0,355,145,700),cut(box(180,0,635,330),box(180,125,485,215)),p([(345,365),(505,365),(650,700),(465,700)])),650),
    "A": glyph(join(p([(220,0),(440,0),(500,175),(385,175),(340,85),(275,175),(160,175)]),p([(145,215),(285,215),(145,700),(0,700)]),p([(395,215),(535,215),(670,700),(525,700)]),p([(245,405),(435,405),(475,535),(205,535)])),670),
    "I": glyph(join(box(0,0,330,145),box(90,180,240,520),box(0,555,330,700)),330),
    "N": glyph(join(box(0,0,145,700),box(520,0,665,700),p([(185,0),(330,0),(480,700),(335,700)])),665),
}

# 04: Inflated, uneven angular masses, rather than rounded bubble outlines.
def swollen(points, *holes):
    return scale(cut(p(points), *(p(hole) for hole in holes)) if holes else p(points), xfact=9, yfact=9, origin=(0,0))
inflated = {
    "G": glyph(swollen([(20,1),(59,0),(75,14),(70,29),(49,31),(52,22),(32,23),(23,35),(21,49),(30,57),(48,54),(51,44),(37,45),(40,34),(75,32),(67,64),(50,77),(12,72),(0,54),(7,23)]),675),
    "R": glyph(swollen([(12,3),(53,0),(75,14),(69,35),(56,45),(74,74),(49,78),(34,48),(26,51),(23,74),(0,75),(7,42),(3,27)],[(30,20),(51,18),(55,26),(49,34),(27,36)]),675),
    "A": glyph(swollen([(33,0),(62,2),(77,26),(74,75),(50,78),(51,55),(28,54),(20,75),(0,74),(14,31)],[(43,23),(34,40),(50,41),(49,24)]),693),
    "I": glyph(swollen([(15,2),(46,0),(41,20),(35,22),(29,54),(36,59),(29,77),(0,75),(6,55),(11,51),(17,23),(9,18)]),414),
    "N": glyph(swollen([(15,0),(39,3),(54,42),(62,4),(84,0),(75,72),(60,79),(44,73),(29,36),(22,75),(0,75),(8,22)]),756),
}

# 05: Continuous folded diagonal ribbons with diamond-shaped inner spaces.
ribbon = {
    "G": glyph(stroke([(570,145),(420,30),(200,30),(15,350),(200,670),(430,670),(590,390),(355,390)],100),640),
    "R": glyph(join(stroke([(30,670),(220,30),(435,30),(580,170),(480,350),(130,350)],105),stroke([(300,350),(520,670)],105)),640),
    "A": glyph(join(stroke([(25,670),(390,30),(590,670)],110),stroke([(155,460),(515,460)],85)),650),
    "I": glyph(join(p([(135,0),(440,0),(365,105),(270,105),(95,595),(225,595),(170,700),(0,700),(25,595),(160,105),(75,105)])),460),
    "N": glyph(stroke([(20,670),(210,30),(300,30),(390,670),(485,670),(670,30)],105),725),
}

# 06: Fine circuit traces, rectangular terminals, open engineered joints.
circuit = {
    "G": glyph(join(stroke([(595,160),(595,40),(90,40),(40,90),(40,610),(90,660),(595,660),(595,365),(355,365)],65),box(565,125,625,195),box(320,335,385,395)),635),
    "R": glyph(join(stroke([(40,660),(40,40),(540,40),(600,100),(600,285),(540,345),(40,345)],65),stroke([(325,345),(600,620),(600,660)],65),box(570,630,630,690)),635),
    "A": glyph(join(stroke([(40,660),(40,200),(205,40),(440,40),(605,200),(605,660)],65),stroke([(40,420),(270,420)],65),stroke([(375,420),(605,420)],65),box(275,390,335,450)),645),
    "I": glyph(join(stroke([(40,40),(360,40)],65),stroke([(200,40),(200,660)],65),stroke([(40,660),(360,660)],65),box(170,325,230,385)),400),
    "N": glyph(join(stroke([(40,660),(40,40),(125,40),(515,660),(600,660),(600,40)],65),box(290,320,350,380)),640),
}

# 07: A bevelled seven-row segmented alphabet; no borrowed bitmap font.
bitmaps = {
    "G": ["01111","11000","10000","10111","10001","11001","01111"],
    "R": ["11110","10001","10001","11110","10100","10010","10001"],
    "A": ["01110","11011","10001","11111","10001","10001","10001"],
    "I": ["111","010","010","010","010","010","111"],
    "N": ["10001","11001","11001","10101","10011","10011","10001"],
}
segmented = {}
for letter, rows in bitmaps.items():
    cells = [octagon(column*112, row*102, 96, 86, 13) for row, bits in enumerate(rows) for column, bit in enumerate(bits) if bit == "1"]
    segmented[letter] = glyph(join(*cells),len(rows[0])*112-16)

# 08: High-contrast knife forms: swollen stems and very fine connecting blades.
razor = {
    "G": glyph(join(p([(155,0),(680,0),(610,65),(255,80),(170,190),(115,540),(190,635),(460,635),(530,445),(350,445),(380,385),(690,385),(610,625),(480,700),(90,700),(0,565),(90,150)]),p([(600,0),(720,0),(670,155)])),720),
    "R": glyph(cut(p([(125,0),(615,0),(700,100),(655,280),(500,360),(675,700),(465,700),(340,390),(220,390),(160,700),(0,700)]),p([(285,65),(560,65),(590,120),(545,275),(235,320)])),700),
    "A": glyph(join(p([(395,0),(520,0),(690,700),(470,700),(365,160),(50,700),(0,700)]),p([(150,445),(565,445),(580,490),(120,490)]),p([(395,0),(510,-40),(495,45)])),690),
    "I": glyph(join(p([(85,0),(450,0),(425,50),(315,65),(200,640),(345,650),(335,700),(0,700),(10,650),(75,635),(190,65),(70,50)]),p([(450,0),(510,-40),(470,45)])),510),
    "N": glyph(p([(0,700),(125,0),(270,0),(485,500),(575,0),(630,0),(505,700),(355,700),(140,180),(55,700)]),630),
}

# 09: Heavy upright architectural modules, stepped shoulders and square apertures.
brutal = {
    "G": glyph(p([(0,120),(120,120),(120,0),(650,0),(650,175),(230,175),(230,525),(475,525),(475,430),(350,430),(350,290),(650,290),(650,700),(120,700),(120,580),(0,580)]),650),
    "R": glyph(cut(p([(0,0),(560,0),(560,100),(650,100),(650,315),(550,315),(550,420),(420,420),(650,700),(410,700),(230,455),(230,700),(0,700)]),box(230,150,440,285)),650),
    "A": glyph(cut(p([(0,700),(0,130),(130,130),(130,0),(520,0),(520,130),(650,130),(650,700),(420,700),(420,490),(230,490),(230,700)]),box(230,180,420,330)),650),
    "I": glyph(join(box(0,0,420,170),box(110,170,310,530),box(0,530,420,700)),420),
    "N": glyph(p([(0,700),(0,0),(230,0),(230,170),(340,170),(340,350),(420,350),(420,0),(650,0),(650,700),(420,700),(420,530),(310,530),(310,350),(230,350),(230,700)]),650),
}

# 10: Faceted lowercase forms: square bowls, sharp lobes and a deep g descender.
faceted = {
    "G": glyph(cut(p([(115,175),(370,150),(460,195),(535,150),(615,195),(575,640),(520,790),(385,845),(120,825),(45,740),(95,675),(220,715),(390,705),(420,620),(310,655),(115,620),(20,515),(40,305)]),p([(205,300),(360,280),(420,330),(395,465),(300,520),(180,465),(155,380)])),615),
    "R": glyph(p([(0,620),(45,190),(180,160),(200,245),(330,165),(465,175),(530,265),(475,365),(365,300),(275,320),(215,410),(200,620),(95,660)]),530),
    "A": glyph(cut(p([(95,190),(290,150),(400,205),(465,170),(575,205),(530,620),(425,655),(365,590),(265,660),(80,625),(0,495),(30,300)]),p([(185,300),(315,285),(375,340),(340,475),(240,525),(145,470),(130,375)])),575),
    "I": glyph(join(p([(80,215),(240,190),(270,265),(225,560),(245,615),(140,660),(25,620),(50,460)]),p([(110,10),(245,0),(290,80),(235,150),(105,140),(65,75)])),290),
    "N": glyph(p([(0,640),(45,195),(170,160),(205,230),(310,165),(465,180),(550,280),(530,515),(565,585),(630,615),(555,660),(390,635),(350,565),(375,345),(315,305),(230,335),(195,420),(180,630),(80,665)]),630),
}

OPTIONS = [
    ("01", "Extended rails", extended),
    ("02", "Compressed towers", compressed),
    ("03", "Stencil plates", stencil),
    ("04", "Angular inflation", inflated),
    ("05", "Folded ribbons", ribbon),
    ("06", "Circuit traces", circuit),
    ("07", "Bevelled segments", segmented),
    ("08", "Razor contrast", razor),
    ("09", "Stepped blocks", brutal),
    ("10", "Faceted lowercase", faceted),
]


def outline(shape):
    pen = TTGlyphPen(None)
    geometry = shape.buffer(0)
    polygons = list(geometry.geoms) if geometry.geom_type == "MultiPolygon" else [geometry]
    for polygon in polygons:
        polygon = orient(polygon, sign=1.0)
        for ring in [polygon.exterior, *polygon.interiors]:
            points = [(round(x + 20), round(750 - y)) for x, y in list(ring.coords)[:-1]]
            if len(points) < 3:
                continue
            pen.moveTo(points[0])
            for point in points[1:]:
                pen.lineTo(point)
            pen.closePath()
    return pen.glyph()


manifest = []
for identifier, label, letters in OPTIONS:
    family = f"Grain Title {identifier}"
    builder = FontBuilder(1000, isTTF=True)
    order = [".notdef", "space", "period", "hyphen", "G", "R", "A", "I", "N"]
    builder.setupGlyphOrder(order)
    charmap = {32:"space",46:"period",45:"hyphen"}
    for letter in "GRAIN":
        charmap[ord(letter)] = letter
        charmap[ord(letter.lower())] = letter
    builder.setupCharacterMap(charmap)
    empty = TTGlyphPen(None).glyph()
    glyphs = {
        ".notdef":outline(cut(box(0,0,450,700),box(70,70,380,630))),
        "space":empty,
        "period":outline(octagon(0,590,110,110,20)),
        "hyphen":outline(box(0,330,270,420)),
    }
    metrics = {".notdef":(490,20),"space":(320,0),"period":(160,20),"hyphen":(310,20)}
    for letter, (shape, width) in letters.items():
        glyphs[letter] = outline(shape)
        metrics[letter] = (round(width+40),round(shape.bounds[0]+20))
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=900,descent=-180)
    builder.setupNameTable({
        "familyName":family,
        "styleName":"Regular",
        "uniqueFontIdentifier":f"Grain:Title{identifier}:2026",
        "fullName":f"{family} Regular",
        "psName":f"GrainTitle{identifier}-Regular",
        "version":"Version 1.000",
        "copyright":"Original outlines created for Grain, 2026. No third-party font outlines.",
        "description":f"{label}. Limited title alphabet: GRAINgrain, space, period and hyphen. Not a complete type family.",
    })
    builder.setupOS2(sTypoAscender=900,sTypoDescender=-180,sTypoLineGap=0,usWinAscent=900,usWinDescent=180,sxHeight=550,sCapHeight=750,fsType=0)
    builder.setupPost()
    builder.setupMaxp()
    builder.font["head"].created = builder.font["head"].modified = 3887395200
    filename = f"grain-{identifier}"
    builder.save(FONTS / f"{filename}.ttf")
    builder.font.flavor = "woff2"
    builder.save(FONTS / f"{filename}.woff2")
    manifest.append({"id":identifier,"label":label,"family":family,"woff2":f"/title-fonts/fonts/{filename}.woff2","ttf":f"/title-fonts/fonts/{filename}.ttf","grainAdvanceEm":sum(metrics[letter][0] for letter in "GRAIN")/1000})
(ROOT / "manifest.json").write_text(json.dumps(manifest,indent=2)+"\n")
