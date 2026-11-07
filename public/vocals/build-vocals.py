"""Create compact sampler WAVs from the two official CC0 Kenney voice packs.

Requires Python, numpy and ffmpeg. Set GRAIN_VOCAL_SOURCE_DIR to the extracted
pack directory. Download sources from the primary URLs in provenance.json.
No source recordings are synthesized or borrowed from commercial music.
"""
from pathlib import Path
import os
import json
import math
import hashlib
import subprocess
import wave
import numpy as np

ROOT = Path(__file__).resolve().parent
SOURCES = Path(os.environ.get('GRAIN_VOCAL_SOURCE_DIR','/tmp/grain-vocal-sources'))
RATE = 44100
PEAK = 10**(-1/20)

SELECTION = [
    ('female-go','Go','female','word','go',None),
    ('female-ready','Ready','female','word','ready',None),
    ('female-set','Set','female','word','set',None),
    ('female-one','One','female','word','1',None),
    ('female-two','Two','female','word','2',None),
    ('female-oh','Go vowel','female','vowel','go',.22),
    ('female-ee','Three vowel','female','vowel','3',.20),
    ('female-set-cut','Set attack','female','cut','set',.12),
    ('male-go','Go','male','word','go',None),
    ('male-ready','Ready','male','word','ready',None),
    ('male-hold','Hold','male','word','hold',None),
    ('male-one','One','male','word','1',None),
    ('male-two','Two','male','word','2',None),
    ('male-oh','Go vowel','male','vowel','go',.22),
    ('male-ee','Three vowel','male','vowel','3',.22),
    ('male-set-cut','Set attack','male','cut','set',.12),
    ('fighter-begin','Begin','fighter','word','begin',None),
    ('fighter-fight','Fight','fighter','word','fight',None),
    ('fighter-time','Time','fighter','word','time',None),
    ('fighter-combo','Combo','fighter','word','combo',None),
    ('fighter-one','One','fighter','word','1',None),
    ('fighter-two','Two','fighter','word','2',None),
    ('fighter-ai','Fight vowel','fighter','vowel','fight',.22),
    ('fighter-fight-cut','Fight attack','fighter','cut','fight',.16),
]


def decode(path):
    raw = subprocess.check_output(['ffmpeg','-v','error','-i',str(path),'-ac','1','-ar',str(RATE),'-f','f32le','pipe:1'])
    samples = np.frombuffer(raw,dtype='<f4').astype(np.float64)
    if not len(samples) or not np.all(np.isfinite(samples)):
        raise ValueError('Invalid decoded audio')
    samples -= np.mean(samples)
    return samples


def voiced_window(samples,start,end,duration):
    """Choose a strong periodic section inside the word, without claiming tuning."""
    length = round(duration*RATE)
    first = start+round((end-start)*.14)
    last = min(end-length,start+round((end-start)*.76))
    if last<first:
        return start,min(end,start+length)
    best = None
    for position in range(first,last+1,round(.01*RATE)):
        segment = samples[position:position+length]
        reduced = segment[::4]
        reduced = (reduced-reduced.mean())*np.hanning(len(reduced))
        size = 1 << (2*len(reduced)-1).bit_length()
        spectrum = np.fft.rfft(reduced,size)
        autocorrelation = np.fft.irfft(spectrum*np.conj(spectrum),size)[:len(reduced)]
        energy = float(np.sqrt(np.mean(segment*segment)))
        periodicity = float(np.max(autocorrelation[round(RATE/4/700):round(RATE/4/65)]) / max(autocorrelation[0],1e-12))
        score = periodicity*math.sqrt(energy)
        if best is None or score>best[0]:
            best = (score,position)
    if best is None:
        raise ValueError('No voiced region found')
    return best[1],best[1]+length


samples_metadata=[]
for identifier,name,voice,category,basename,length in SELECTION:
    if voice=='fighter':
        pack='voiceover-pack-fighter'
        relative=Path('Audio')/(basename+'.ogg')
        performer=None
        gender='male'
        license_path='/vocals/licenses/kenney-fighter-CC0.txt'
    else:
        pack='voiceover-pack'
        relative=Path('Female' if voice=='female' else 'Male')/(basename+'.ogg')
        performer='Giselle' if voice=='female' else 'Jeffrey M. Smith'
        gender=voice
        license_path='/vocals/licenses/kenney-voiceover-CC0.txt'
    path=SOURCES/pack/relative
    data=decode(path)
    threshold=max(.0025,float(np.max(np.abs(data)))*.008)
    active=np.flatnonzero(np.abs(data)>threshold)
    if not len(active):
        raise ValueError('Source recording is silent')
    start=max(0,int(active[0])-round(.004*RATE))
    end=min(len(data),int(active[-1])+round(.012*RATE))
    if category=='vowel':
        if length is None:
            raise ValueError('Vowel length is missing')
        start,end=voiced_window(data,start,end,length)
    elif category=='cut':
        if length is None:
            raise ValueError('Cut length is missing')
        end=min(end,start+round(length*RATE))
    clip=data[start:end].copy()
    if len(clip)<round(.04*RATE):
        raise ValueError('Clip is too short')
    clip-=np.mean(clip)
    fade_in_ms=7 if category=='vowel' else 2
    fade_out_ms=9 if category=='vowel' else 6
    fade_in=min(round(fade_in_ms*RATE/1000),len(clip)//3)
    fade_out=min(round(fade_out_ms*RATE/1000),len(clip)//3)
    clip[:fade_in]*=np.linspace(0,1,fade_in)
    clip[-fade_out:]*=np.linspace(1,0,fade_out)
    gain=PEAK/max(float(np.max(np.abs(clip))),1e-12)
    clip*=gain
    pcm=np.rint(np.clip(clip,-1,1)*32767).astype('<i2')
    output=ROOT/'audio'/(identifier+'.wav')
    with wave.open(str(output),'wb') as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(RATE)
        wav.writeframes(pcm.tobytes())
    peaks=[round(float(np.max(np.abs(chunk))),4) for chunk in np.array_split(clip,128)]
    samples_metadata.append({
        'id':identifier,'name':name,'voice':voice,'category':category,
        'url':'/vocals/audio/'+identifier+'.wav','duration':round(len(clip)/RATE,6),
        'sampleRate':RATE,'channels':1,'frames':len(clip),'rootNote':60,
        'peak':round(float(np.max(np.abs(clip))),6),'rms':round(float(np.sqrt(np.mean(clip*clip))),6),
        'peaks':peaks,
        'source':{'pack':pack,'file':relative.as_posix(),'page':'https://kenney.nl/assets/'+pack,
                  'license':'CC0-1.0','licenseUrl':'https://creativecommons.org/publicdomain/zero/1.0/',
                  'licenseFile':license_path,'performer':performer,'gender':gender,
                  'sha256':hashlib.sha256(path.read_bytes()).hexdigest(),
                  'decodedDuration':round(len(data)/RATE,6),'startSeconds':round(start/RATE,6),
                  'endSeconds':round(end/RATE,6)},
        'processing':{'gainDb':round(20*math.log10(gain),3),'fadeInMs':fade_in_ms,'fadeOutMs':fade_out_ms},
    })

catalog={'version':1,'rootNoteMeaning':'MIDI 60 (C4) is the unity playback reference, not a measured musical fundamental. These are untuned spoken voices.',
         'format':'Mono PCM16 WAV, 44.1kHz; silence-trimmed, DC removed, -1dBFS peak, short edge fades.',
         'samples':samples_metadata}
(ROOT/'catalog.json').write_text(json.dumps(catalog,indent=2)+'\n')
provenance={'publisher':'Kenney','license':'CC0-1.0','licenseUrl':'https://creativecommons.org/publicdomain/zero/1.0/',
            'packs':[{'name':'Voiceover Pack','page':'https://kenney.nl/assets/voiceover-pack','archiveSha256':hashlib.sha256((SOURCES/'voiceover-pack.zip').read_bytes()).hexdigest(),'licenseFile':'licenses/kenney-voiceover-CC0.txt','creditsFile':'licenses/kenney-voiceover-credits.txt'},
                     {'name':'Voiceover Pack (Fighter)','page':'https://kenney.nl/assets/voiceover-pack-fighter','archiveSha256':hashlib.sha256((SOURCES/'voiceover-pack-fighter.zip').read_bytes()).hexdigest(),'licenseFile':'licenses/kenney-fighter-CC0.txt'}],
            'modifications':'Selected short words; extracted voiced windows and onset cuts; downmixed to mono; silence trimmed; DC removed; edge fades; peak normalization; PCM16 WAV export.',
            'pitch':'rootNote 60 is a sampler playback reference only. No fixed root pitch is claimed or baked in.',
            'performers':{'female':'Giselle','male':'Jeffrey M. Smith','fighter':None}}
(ROOT/'provenance.json').write_text(json.dumps(provenance,indent=2)+'\n')
print(json.dumps({'count':len(samples_metadata),'duration':round(sum(item['duration'] for item in samples_metadata),3),'bytes':sum(path.stat().st_size for path in (ROOT/'audio').glob('*.wav')),'clips':[{'id':item['id'],'duration':item['duration']} for item in samples_metadata]},indent=2))
