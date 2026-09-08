"""Build the reusable TouchDesigner authoring network.

Run from TouchDesigner's Textport:

    exec(open('/Users/braden/Development/bradenm.co.uk/touchdesigner/build-project.py').read())

The file intentionally uses TouchDesigner's built-in Python API only. Keeping the builder
next to the binary .toe makes the project reviewable, diffable and recoverable.
"""

from pathlib import Path


REPO = Path("/Users/braden/Development/bradenm.co.uk")
TD_ROOT = REPO / "touchdesigner"
PROJECT_PATH = TD_ROOT / "about-portrait.toe"


def connect(source, target, index=0):
    target.inputConnectors[index].connect(source)


def annotate(parent, name, text, x, y, width=420, height=90):
    note = parent.create(textDAT, name)
    note.nodeX = x
    note.nodeY = y
    note.nodeWidth = width
    note.nodeHeight = height
    note.text = text
    return note


def build(save_project=True):
    network = op("/ABOUT_PORTRAIT") or op("/project1")
    child_paths = [child.path for child in network.children]
    for child_path in child_paths:
        child = op(child_path)
        if child is not None:
            child.destroy()

    source = network.create(moviefileinTOP, "SOURCE_VIDEO")
    source.nodeX = 0
    source.nodeY = 120
    source.par.file = str(TD_ROOT / "input" / "braden-gelato-clean-loop-v2.mp4")
    source.par.playmode = "locked"
    source.par.play = True
    source.par.cue = False
    source.par.outputresolution = "custom"
    source.par.resolutionw = 1200
    source.par.resolutionh = 800

    matte = network.create(moviefileinTOP, "SUBJECT_MATTE")
    matte.nodeX = 0
    matte.nodeY = -20
    matte.par.file = str(TD_ROOT / "input" / "braden-gelato-clean-matte-loop-v2.mp4")
    matte.par.playmode = "locked"
    matte.par.play = True
    matte.par.cue = False
    matte.par.outputresolution = "custom"
    matte.par.resolutionw = 1200
    matte.par.resolutionh = 800

    atlas = network.create(moviefileinTOP, "GLYPH_ATLAS")
    atlas.nodeX = 0
    atlas.nodeY = -160
    atlas.par.file = str(TD_ROOT / "assets" / "glyph-atlas.png")
    atlas.par.playmode = "specify"
    atlas.par.index = 0

    portrait_atlas = network.create(moviefileinTOP, "REFERENCE_GLYPH_ATLAS")
    portrait_atlas.nodeX = 0
    portrait_atlas.nodeY = -300
    portrait_atlas.par.file = str(TD_ROOT / "assets" / "reference-glyph-atlas.png")
    portrait_atlas.par.playmode = "specify"
    portrait_atlas.par.index = 0

    prop_support = network.create(moviefileinTOP, "PROP_SUPPORT")
    prop_support.nodeX = 0
    prop_support.nodeY = -440
    prop_support.par.file = str(TD_ROOT / "assets" / "prop-support.png")
    prop_support.par.playmode = "specify"
    prop_support.par.index = 0

    matte_packer_dat = network.create(textDAT, "MATTE_PACKER_SHADER")
    matte_packer_dat.nodeX = 180
    matte_packer_dat.nodeY = -440
    matte_packer_dat.nodeWidth = 180
    matte_packer_dat.nodeHeight = 80
    matte_packer_dat.text = (TD_ROOT / "shaders" / "pack-mattes.frag").read_text(
        encoding="utf-8"
    )

    matte_packer = network.create(glslTOP, "PACKED_MATTES")
    matte_packer.nodeX = 200
    matte_packer.nodeY = -80
    matte_packer.par.pixeldat = matte_packer_dat
    matte_packer.par.outputresolution = "custom"
    matte_packer.par.resolutionw = 1200
    matte_packer.par.resolutionh = 800
    matte_packer.par.format = "rgba16float"
    connect(matte, matte_packer, 0)
    connect(prop_support, matte_packer, 1)

    shader_dat = network.create(textDAT, "TYPOGRAVURE_SHADER")
    shader_dat.nodeX = 300
    shader_dat.nodeY = -180
    shader_dat.nodeWidth = 180
    shader_dat.nodeHeight = 80
    shader_dat.text = (TD_ROOT / "shaders" / "typogravure.frag").read_text(encoding="utf-8")

    shader = network.create(glslmultiTOP, "TYPOGRAVURE")
    shader.nodeX = 320
    shader.nodeY = 80
    shader.par.pixeldat = shader_dat
    shader.par.outputresolution = "custom"
    # TouchDesigner Non-Commercial caps a requested 2400 x 1600 TOP at
    # 1280 x 853. Rendering at the final master size keeps uGrid in real output
    # pixels instead of silently turning a nominal 5 px cell into a 9.4 px one.
    shader.par.resolutionw = 1200
    shader.par.resolutionh = 800
    shader.par.format = "rgba16float"
    # The reference atlas is intentionally much higher resolution than each
    # rendered cell. Linear input sampling preserves its fine internal strokes;
    # nearest sampling collapses them into chunky rectangular tiles.
    shader.par.inputfiltertype = "linear"
    shader.par.vec = 8
    shader.par.vec0name = "uGrid"
    shader.par.vec0valuex = 5.0
    shader.par.vec0valuey = 5.375
    shader.par.vec0valuez = 0.0
    shader.par.vec0valuew = 0.0
    shader.par.vec1name = "uWash"
    shader.par.vec1valuex = 0.965
    shader.par.vec1valuey = 0.56
    shader.par.vec1valuez = 0.11
    shader.par.vec1valuew = 0.0
    shader.par.vec2name = "uGlyph"
    shader.par.vec2valuex = 0.58
    shader.par.vec2valuey = 0.085
    shader.par.vec2valuez = 0.18
    shader.par.vec2valuew = 0.48
    shader.par.vec3name = "uAtmosphere"
    shader.par.vec3valuex = 0.92
    shader.par.vec3valuey = 0.31
    shader.par.vec3valuez = 0.0
    shader.par.vec3valuew = 0.0
    shader.par.vec4name = "uInk"
    shader.par.vec4valuex = 48.0 / 255.0
    shader.par.vec4valuey = 36.0 / 255.0
    shader.par.vec4valuez = 27.0 / 255.0
    shader.par.vec4valuew = 0.5
    shader.par.vec5name = "uFace"
    shader.par.vec5valuex = 116.0 / 255.0
    shader.par.vec5valuey = 78.0 / 255.0
    shader.par.vec5valuez = 50.0 / 255.0
    shader.par.vec5valuew = 5.0 / 255.0
    shader.par.vec6name = "uCarrier"
    shader.par.vec6valuex = 0.95
    shader.par.vec6valuey = 0.085
    shader.par.vec6valuez = 1.05
    shader.par.vec6valuew = 0.0
    shader.par.vec7name = "uComposition"
    shader.par.vec7valuex = 1.13
    shader.par.vec7valuey = 0.018
    shader.par.vec7valuez = 0.031
    shader.par.vec7valuew = 0.0
    connect(source, shader, 0)
    connect(matte_packer, shader, 1)
    connect(atlas, shader, 2)
    connect(portrait_atlas, shader, 3)

    final = network.create(nullTOP, "FINAL_RGBA")
    final.nodeX = 570
    final.nodeY = 80
    final.viewer = True
    final.display = True
    final.render = True
    connect(shader, final)

    info = network.create(textDAT, "README")
    info.nodeX = 590
    info.nodeY = -110
    info.nodeWidth = 200
    info.nodeHeight = 100
    info.text = (TD_ROOT / "README.md").read_text(encoding="utf-8")

    annotate(
        network,
        "NOTE_INPUTS",
        "SOURCE + DYNAMIC MATTE + TWO GLYPH ATLASES + PROP SUPPORT\nInputs and carrier stay registered at the 1200 x 800 alpha-video master.",
        -30,
        260,
        430,
        82,
    )
    annotate(
        network,
        "NOTE_RENDER",
        "GPU TYPOGRAVURE\n936 fixed portrait marks; tone changes weight, opacity and umber depth only.",
        305,
        260,
        470,
        82,
    )
    annotate(
        network,
        "NOTE_OUTPUT",
        "TRANSPARENT MASTER\nRecord FINAL_RGBA as 48 straight-alpha PNGs; encode outside TD.",
        600,
        220,
        380,
        82,
    )

    if save_project:
        project.save(str(PROJECT_PATH))
    print("CODEX_TD_PROJECT_BUILT", PROJECT_PATH)
    print("CODEX_TD_SHADER_ERRORS", shader.errors())
    print("CODEX_TD_OUTPUT", final.width, final.height)
    return network


if __name__ == "__main__":
    build()
