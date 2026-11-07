"""OFL-derived title cuts, preserving the professional source outlines.

Sources and hashes are listed in round-3-sources.json; full OFL notices are
in licenses/. Set GRAIN_FONT_SOURCE_DIR to a directory containing the original
family subdirectories downloaded from the primary Google Fonts repository.
All modified font families are renamed, including Reserved Font Names.
"""
from pathlib import Path
import json
import os
import re
from fontTools.fontBuilder import FontBuilder
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.boundsPen import BoundsPen
from fontTools.pens.recordingPen import DecomposingRecordingPen
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen

ROOT = Path(__file__).resolve().parent
SOURCES = Path(os.environ.get('GRAIN_FONT_SOURCE_DIR','/tmp/grain-round3-sources'))
source_info = {source['family']:source for source in json.loads((SOURCES/'sources.json').read_text())}
OPTIONS = [
    ('21','Wide modular','orbitron',{'wght':900},1.02),
    ('22','Compressed instrument','chakrapetch',{},.84),
    ('23','Industrial stencil','sairastencilone',{},1.0),
    ('24','Precision raster','doto',{'wght':900,'ROND':0},1.0),
    ('25','Oscilloscope','michroma',{},1.08),
    ('26','Segmented radar','brunoacesc',{},1.02),
    ('27','Continuous routing','audiowide',{},1.0),
    ('28','Angular aerospace','oxanium',{'wght':800},1.02),
    ('29','Technical slab','russoone',{},1.04),
    ('30','Constructivist','stalinistone',{},.96),
]
manifest=[entry for entry in json.loads((ROOT/'manifest.json').read_text()) if int(entry['id'])<=20]
credits=[]
for identifier,label,directory,axes,width_factor in OPTIONS:
    source=source_info[directory]
    original=TTFont(SOURCES/directory/source['file'])
    if axes:
        original=instantiateVariableFont(original,axes,inplace=False)
    glyph_set=original.getGlyphSet()
    cmap=original.getBestCmap()
    bounds=BoundsPen(glyph_set)
    glyph_set[cmap[ord('I')]].draw(bounds)
    if bounds.bounds is None:
        raise ValueError('Source cap height is missing')
    cap=bounds.bounds[3]-bounds.bounds[1]
    factor=740/cap
    glyphs={}
    metrics={}
    for character,name in [(letter,letter) for letter in 'GRAIN']+[('.', 'period'),('-', 'hyphen')]:
        recording=DecomposingRecordingPen(glyph_set)
        glyph_set[cmap[ord(character)]].draw(recording)
        transform=(factor*width_factor,0,0,factor,0,0)
        measurement=BoundsPen(None)
        recording.replay(TransformPen(measurement,transform))
        if measurement.bounds is None:
            raise ValueError('Source glyph has no outline')
        minx,_,maxx,_=measurement.bounds
        left=24
        pen=TTGlyphPen(None)
        recording.replay(TransformPen(pen,(factor*width_factor,0,0,factor,left-minx,0)))
        glyphs[name]=pen.glyph()
        right=24
        if character=='R':
            right=12
        elif character=='A':
            right=18
        elif character=='I':
            right=30
        metrics[name]=(round(maxx-minx+left+right),left)
    glyphs['space']=TTGlyphPen(None).glyph()
    metrics['space']=(300,0)
    missing=TTGlyphPen(None)
    missing.moveTo((24,0));missing.lineTo((424,0));missing.lineTo((424,740));missing.lineTo((24,740));missing.closePath()
    missing.moveTo((84,60));missing.lineTo((84,680));missing.lineTo((364,680));missing.lineTo((364,60));missing.closePath()
    glyphs['.notdef']=missing.glyph()
    metrics['.notdef']=(448,24)
    family=f'Grain Title {identifier}'
    builder=FontBuilder(1000,isTTF=True)
    builder.setupGlyphOrder(['.notdef','space','period','hyphen','G','R','A','I','N'])
    character_map={32:'space',45:'hyphen',46:'period'}
    for letter in 'GRAIN':
        character_map[ord(letter)]=character_map[ord(letter.lower())]=letter
    builder.setupCharacterMap(character_map)
    builder.setupGlyf(glyphs)
    builder.setupHorizontalMetrics(metrics)
    builder.setupHorizontalHeader(ascent=870,descent=-130)
    metadata=(SOURCES/directory/'METADATA.pb').read_text()
    source_match=re.search(r'^name: "([^"]+)"',metadata)
    designer_match=re.search(r'^designer: "([^"]+)"',metadata,re.MULTILINE)
    if source_match is None or designer_match is None:
        raise ValueError('Source attribution is missing')
    source_name=source_match.group(1)
    designer=designer_match.group(1)
    license_text=(ROOT/'licenses'/f'{directory}-OFL.txt').read_text()
    copyright_line=license_text.split('\n\n')[0]
    builder.setupNameTable({'familyName':family,'styleName':'Regular','uniqueFontIdentifier':f'Grain:Title{identifier}:2026','fullName':f'{family} Regular','psName':f'GrainTitle{identifier}-Regular','version':'Version 1.000','copyright':copyright_line,'designer':designer,'description':f'Title subset derived from {source_name}. Source outlines retained; cap height, width and title spacing adapted. Supported: GRAINgrain, space, period and hyphen.','licenseDescription':license_text,'licenseInfoURL':'https://openfontlicense.org'})
    builder.setupOS2(sTypoAscender=870,sTypoDescender=-130,sTypoLineGap=0,usWinAscent=870,usWinDescent=130,sxHeight=740,sCapHeight=740,fsType=0)
    builder.setupPost()
    builder.setupMaxp()
    builder.font.recalcTimestamp=False
    builder.font['head'].created=builder.font['head'].modified=3876854400
    builder.save(ROOT/'fonts'/f'grain-{identifier}.ttf')
    builder.font.flavor='woff2'
    builder.save(ROOT/'fonts'/f'grain-{identifier}.woff2')
    manifest.append({'id':identifier,'label':label,'family':family,'woff2':f'/title-fonts/fonts/grain-{identifier}.woff2','ttf':f'/title-fonts/fonts/grain-{identifier}.ttf','grainAdvanceEm':sum(metrics[letter][0] for letter in 'GRAIN')/1000})
    credits.append({'id':identifier,'sourceFamily':source_name,'designer':designer,'sourceUrl':source['sourceUrl'],'sourceFile':source['file'],'sourceSha256':source['sha256'],'axes':axes,'widthFactor':width_factor,'license':f'./licenses/{directory}-OFL.txt','modifications':'Title alphabet subset; static weight; cap-height normalization; width and title-spacing adjustments; renamed family. Original glyph outlines retained.'})
(ROOT/'manifest.json').write_text(json.dumps(manifest,indent=2)+'\n')
(ROOT/'round-3-sources.json').write_text(json.dumps(credits,indent=2)+'\n')
