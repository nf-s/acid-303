"""Original particle title alphabets 11–20. No source font outlines are used."""
from pathlib import Path
import json
import math
import random
import re
from fontTools.fontBuilder import FontBuilder
from fontTools.pens.ttGlyphPen import TTGlyphPen
from shapely.geometry import Point
from shapely.ops import unary_union
from shapely.geometry.polygon import orient

ROOT = Path(__file__).resolve().parent
FONTS = ROOT / "fonts"

# Deliberately asymmetric hand-drawn centre lines, not a regular pixel grid.
FLOW = {
    "G": [[(530,150),(435,70),(240,65),(90,190),(65,395),(140,575),(325,635),(515,565),(535,380),(335,385)]],
    "R": [[(80,645),(95,425),(75,245),(105,70)],[(105,70),(350,65),(510,140),(515,265),(390,350),(90,355)],[(310,355),(405,460),(535,645)]],
    "A": [[(50,645),(130,445),(235,190),(330,65),(425,245),(535,645)],[(140,420),(310,445),(455,420)]],
    "I": [[(70,80),(255,60)],[(175,80),(155,290),(170,465),(135,630)],[(45,640),(240,620)]],
    "N": [[(75,645),(90,440),(65,245),(85,70),(220,240),(390,445),(515,645),(500,390),(525,70)]],
}
WIDE = {
    "G": [[(670,160),(530,60),(250,75),(70,210),(55,425),(175,600),(435,630),(650,540),(640,360),(390,365)]],
    "R": [[(70,650),(90,425),(70,80)],[(75,80),(390,55),(625,125),(660,255),(500,350),(85,350)],[(390,350),(490,480),(670,645)]],
    "A": [[(50,645),(195,350),(355,65),(490,290),(655,645)],[(165,430),(365,450),(550,410)]],
    "I": [[(55,70),(340,65)],[(205,80),(170,325),(200,640)],[(40,640),(335,625)]],
    "N": [[(65,645),(85,360),(70,65),(225,195),(470,510),(645,645),(630,355),(660,65)]],
}
KNOTS = {
    "G": [[(475,160),(370,60),(195,105),(60,260),(90,465),(250,625),(440,585),(520,450),(450,350),(325,390)]],
    "R": [[(60,655),(90,360),(65,85)],[(70,85),(310,50),(480,150),(470,290),(300,375),(85,340)],[(280,365),(365,510),(520,645)]],
    "A": [[(40,645),(135,390),(270,55),(390,350),(520,645)],[(125,445),(280,410),(420,445)]],
    "I": [[(60,65),(225,90)],[(145,85),(175,285),(120,470),(155,630)],[(65,640),(240,615)]],
    "N": [[(60,645),(105,390),(70,65),(220,250),(330,450),(495,630),(470,355),(525,70)]],
}
LOWER = {
    "G": [[(430,230),(335,170),(170,205),(75,335),(120,495),(285,535),(420,420),(420,215),(425,470),(390,695),(250,770),(90,715)]],
    "R": [[(70,610),(85,390),(75,195)],[(85,345),(235,190),(390,215),(440,290)]],
    "A": [[(425,235),(310,175),(150,210),(65,365),(125,510),(290,545),(405,430),(435,195),(420,410),(440,610)]],
    "I": [[(90,265),(120,440),(85,600)],[(120,90),(125,105)]],
    "N": [[(65,615),(90,385),(70,195)],[(90,360),(235,205),(375,195),(435,310),(420,495),(455,610)]],
}


def smooth(points):
    padded = [points[0], *points, points[-1]]
    result = []
    for index in range(1, len(padded)-2):
        a,b,c,d = padded[index-1:index+3]
        length = math.hypot(c[0]-b[0],c[1]-b[1])
        for sample in range(max(3,round(length/7))):
            t = sample/max(3,round(length/7))
            result.append(tuple(.5*((2*b[axis])+(-a[axis]+c[axis])*t+(2*a[axis]-5*b[axis]+4*c[axis]-d[axis])*t*t+(-a[axis]+3*b[axis]-3*c[axis]+d[axis])*t*t*t) for axis in (0,1)))
    result.append(points[-1])
    return result


def along(points, spacing):
    line = smooth(points)
    total = sum(math.dist(a,b) for a,b in zip(line,line[1:]))
    distance = 0
    target = 0
    for a,b in zip(line,line[1:]):
        length = math.dist(a,b)
        if length == 0:
            continue
        while target <= distance+length:
            t = (target-distance)/length
            yield a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,-(b[1]-a[1])/length,(b[0]-a[0])/length,target/max(1,total)
            target += spacing
        distance += length


def particle(x,y,r,rng,ratio=1):
    # A slightly imperfect mineral grain, rather than a perfect repeated circle.
    phase = rng.uniform(0,math.tau)
    return [(x+math.cos(phase+index*math.tau/8)*r*rng.uniform(.8,1.16), y+math.sin(phase+index*math.tau/8)*r*ratio*rng.uniform(.8,1.16)) for index in range(8)]


def grains(identifier, letter):
    rng = random.Random(identifier*1777+ord(letter)*101)
    source = LOWER if identifier == 20 else WIDE if identifier in (12,15) else KNOTS if identifier in (14,16,18) else FLOW
    paths = source[letter]
    particles = []
    core = []
    def emit(x,y,r,ratio=1):
        if identifier == 19:
            x *= .68
            y *= 1.08
        particles.append(particle(x,y,r,rng,ratio))
    spacing = {11:22,12:16,13:15,14:88,15:13,16:19,17:16,18:23,19:25,20:21}[identifier]
    for path_index,path in enumerate(paths):
        samples = list(along(path,spacing))
        for index,(x,y,nx,ny,t) in enumerate(samples):
            phase = t*math.tau + path_index*1.7
            if identifier == 11:
                width = 21+13*math.sin(phase*2+.5)
                for _ in range(5):
                    offset = rng.gauss(0,width)
                    emit(x+nx*offset+rng.uniform(-9,9),y+ny*offset+rng.uniform(-9,9),rng.uniform(4,12))
                if index%3 == 0:
                    emit(x+nx*width*.5,y+ny*width*.5,rng.uniform(13,19))
                if rng.random()<.55:
                    offset = rng.choice([-1,1])*rng.uniform(40,75)
                    emit(x+nx*offset,y+ny*offset,rng.uniform(2,5))
            elif identifier == 12:
                for thread in (-1,0,1):
                    if (index+thread*3+path_index)%19 in (2,3,4) and thread:
                        continue
                    offset = thread*28+12*math.sin(phase*3+thread)
                    emit(x+nx*offset,y+ny*offset,rng.uniform(3.8,7.2))
                    if index%5 == 0:
                        emit(x+nx*(offset+13),y+ny*(offset+13),rng.uniform(2,4))
            elif identifier == 13:
                width = 67+22*math.sin(phase*2.2)
                for _ in range(12):
                    offset = rng.uniform(-width,width)
                    radius = rng.uniform(3.5,11.5)*(1-.25*abs(offset)/width)
                    emit(x+nx*offset+rng.uniform(-12,12),y+ny*offset+rng.uniform(-12,12),radius)
                if index%5 == 0:
                    emit(x+nx*rng.uniform(-20,20),y+ny*rng.uniform(-20,20),rng.uniform(10,15))
                if rng.random()<.7:
                    offset = rng.choice([-1,1])*rng.uniform(width,width+35)
                    emit(x+nx*offset,y+ny*offset,rng.uniform(1.7,3.8))
            elif identifier == 14:
                width = rng.uniform(29,45)
                emit(x+nx*rng.uniform(-10,10),y+ny*rng.uniform(-10,10),width)
                for satellite in range(rng.randint(5,9)):
                    angle = rng.uniform(0,math.tau)
                    distance = rng.uniform(width+4,width+28)
                    emit(x+math.cos(angle)*distance,y+math.sin(angle)*distance,rng.uniform(3,9))
            elif identifier == 15:
                for thread in range(-2,3):
                    offset = thread*14 + 15*math.sin(phase*4+thread*.7)
                    if rng.random()<.12:
                        continue
                    emit(x+nx*offset,y+ny*offset,3.2+2.5*(.5+.5*math.sin(phase*6+thread))+rng.uniform(-.8,.8))
            elif identifier == 16:
                offset = 15*math.sin(phase*4)
                radius = 43+17*math.sin(phase*2+.8)+rng.uniform(-6,6)
                core.append(Point(x+nx*offset,y+ny*offset).buffer(radius,quad_segs=4))
                for _ in range(2):
                    side = rng.choice([-1,1])*rng.uniform(25,60)
                    emit(x+nx*side+rng.uniform(-7,7),y+ny*side+rng.uniform(-7,7),rng.uniform(2,6))
            elif identifier == 17:
                for thread in (-1,1):
                    offset = thread*(19+15*math.sin(phase*5))
                    emit(x+nx*offset,y+ny*offset,rng.uniform(6,12))
                    if index%2 == 0:
                        emit(x+nx*(offset+rng.uniform(-15,15)),y+ny*(offset+rng.uniform(-15,15)),rng.uniform(2,4))
                if index%6 == 0:
                    emit(x,y,rng.uniform(10,16))
            elif identifier == 18:
                offset = 14*math.sin(phase*3)
                emit(x+nx*offset,y+ny*offset,rng.uniform(9,17))
                for plume in range(rng.randint(2,5)):
                    distance = rng.uniform(12,90)
                    emit(x+distance*.28+rng.uniform(-14,14),y-distance,rng.uniform(2,7)*(1-distance/140))
                if index%3 == 0:
                    emit(x+nx*rng.uniform(-25,25),y+ny*rng.uniform(-25,25),rng.uniform(4,8))
            elif identifier == 19:
                for thread in range(3):
                    offset = rng.uniform(-23,23)
                    for drop in range(rng.randint(2,5)):
                        emit(x+nx*offset+rng.uniform(-6,6),y+ny*offset+drop*10,rng.uniform(3,6.5),1.5)
                if index%4 == 0:
                    emit(x,y,10,1.3)
            elif identifier == 20:
                width = 36+20*math.sin(phase*3)
                for _ in range(8):
                    offset = rng.gauss(0,width*.65)
                    emit(x+nx*offset+rng.uniform(-10,10),y+ny*offset+rng.uniform(-10,10),rng.uniform(5,14))
                if index%4 == 0:
                    emit(x+nx*width*.3,y+ny*width*.3,rng.uniform(17,25))
                if index%2 == 0:
                    side = rng.choice([-1,1])*rng.uniform(35,60)
                    emit(x+nx*side,y+ny*side,rng.uniform(2,4))
        if identifier == 14:
            for x,y,nx,ny,t in along(path,13):
                emit(x+nx*6*math.sin(t*34),y+ny*6*math.sin(t*34),rng.uniform(2.5,4.5))
    if core:
        shape = unary_union(core)
        minx,miny,maxx,maxy = shape.bounds
        holes = []
        for _ in range(1500):
            x,y = rng.uniform(minx,maxx),rng.uniform(miny,maxy)
            if shape.contains(Point(x,y)):
                holes.append(Point(x,y).buffer(rng.uniform(3,9),quad_segs=3))
        shape = shape.difference(unary_union(holes))
        pieces = list(shape.geoms) if shape.geom_type == 'MultiPolygon' else [shape]
        for piece in pieces:
            piece = orient(piece,sign=1)
            particles.append(list(piece.exterior.coords)[:-1])
            particles.extend(list(ring.coords)[:-1] for ring in piece.interiors)
    return particles


def outline(contours):
    xs = [point[0] for contour in contours for point in contour]
    minx,maxx = min(xs),max(xs)
    pen = TTGlyphPen(None)
    for contour in contours:
        points = [(round(x-minx+24),round(760-y)) for x,y in contour]
        if len(points)<3:
            continue
        pen.moveTo(points[0])
        for point in points[1:]:
            pen.lineTo(point)
        pen.closePath()
    glyph = pen.glyph()
    if len(glyph.flags):
        glyph.flags[0] |= 0x40
    return glyph, round(maxx-minx+58)


LABELS = {
    11:'Clustered dust',12:'Broken flow contours',13:'Dithered bloom',14:'Satellite knots',
    15:'Interference weave',16:'Eroded ink',17:'Braided spray',18:'Tidal scatter',
    19:'Falling grains',20:'Liquid lowercase',
}
manifest = [entry for entry in json.loads((ROOT/'manifest.json').read_text()) if int(entry['id'])<=10]
for identifier,label in LABELS.items():
    ident = str(identifier)
    family = f'Grain Title {ident}'
    builder = FontBuilder(1000,isTTF=True)
    order = ['.notdef','space','period','hyphen','G','R','A','I','N']
    builder.setupGlyphOrder(order)
    cmap = {32:'space',45:'hyphen',46:'period'}
    for letter in 'GRAIN':
        cmap[ord(letter)] = cmap[ord(letter.lower())] = letter
    builder.setupCharacterMap(cmap)
    missing,_ = outline([[(0,0),(300,0),(300,650),(0,650)],[(50,50),(50,600),(250,600),(250,50)]])
    period,_ = outline([particle(0,640,30,random.Random(identifier))])
    hyphen,_ = outline([particle(x,380,15,random.Random(identifier+x)) for x in range(0,190,27)])
    glyphs = {'.notdef':missing,'space':TTGlyphPen(None).glyph(),'period':period,'hyphen':hyphen}
    metrics = {'.notdef':(360,24),'space':(280,0),'period':(110,24),'hyphen':(250,24)}
    for letter in 'GRAIN':
        glyph,advance = outline(grains(identifier,letter))
        glyphs[letter] = glyph
        metrics[letter] = (advance,24)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=930,descent=-190)
    builder.setupNameTable({'familyName':family,'styleName':'Regular','uniqueFontIdentifier':f'Grain:Title{ident}:2026','fullName':f'{family} Regular','psName':f'GrainTitle{ident}-Regular','version':'Version 1.000','copyright':'Original particle outlines created for Grain, 2026. No third-party font outlines.','description':f'{label}. Limited title alphabet: GRAINgrain, space, period and hyphen. Not a complete type family.'})
    builder.setupOS2(sTypoAscender=930,sTypoDescender=-190,sTypoLineGap=0,usWinAscent=930,usWinDescent=190,sxHeight=560,sCapHeight=760,fsType=0)
    builder.setupPost()
    builder.setupMaxp()
    builder.font.recalcTimestamp = False
    builder.font['head'].created = builder.font['head'].modified = 3876854400
    builder.save(FONTS/f'grain-{ident}.ttf')
    builder.font.flavor = 'woff2'
    builder.save(FONTS/f'grain-{ident}.woff2')
    manifest.append({'id':ident,'label':label,'family':family,'woff2':f'/title-fonts/fonts/grain-{ident}.woff2','ttf':f'/title-fonts/fonts/grain-{ident}.ttf','grainAdvanceEm':sum(metrics[letter][0] for letter in 'GRAIN')/1000})
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')

comparison = ROOT / 'index.html'
if comparison.exists():
    markup = comparison.read_text()
    for entry in manifest:
        pattern = r'(id="option-' + entry['id'] + r'"[\s\S]*?--advance: )[\d.]+'
        markup = re.sub(pattern, lambda match: match.group(1) + str(entry['grainAdvanceEm']), markup)
    comparison.write_text(markup)
