port module Main exposing (main)

import Elm.Pretty
import Elm.Syntax.Expression
import Elm.Syntax.Node
import Elm.Syntax.Range
import Html.Parser
import Platform
import Pretty


port onSuccess : String -> Cmd msg


port onFailure : String -> Cmd msg


main : Program String () ()
main =
    Platform.worker
        { init = init
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }


init : String -> ( (), Cmd () )
init html =
    ( ()
    , case fromHtmlToElm html of
        Just elmCode ->
            onSuccess elmCode

        Nothing ->
            onFailure "Could not parse HTML"
    )


fromHtmlToElm : String -> Maybe String
fromHtmlToElm html =
    case
        html
            |> String.replace "<path " "<pathmango "
            |> String.replace "</path>" "</pathmango>"
            |> String.replace "<path>" "<pathmango>"
            |> String.trim
            |> Html.Parser.run
            |> Result.map toElmString
    of
        Ok elmCode ->
            Just elmCode

        Err problem ->
            Nothing


toElmString : List Html.Parser.Node -> String
toElmString elements =
    let
        doc : Pretty.Doc Elm.Pretty.Tag
        doc =
            case elements of
                [] ->
                    Pretty.empty

                first :: [] ->
                    case toNodeExpression first of
                        Just expression ->
                            Elm.Pretty.prettyExpression expression

                        Nothing ->
                            Pretty.empty

                _ ->
                    elements
                        |> List.filterMap toNodeExpression
                        |> List.map toNode
                        |> Elm.Syntax.Expression.ListExpr
                        |> Elm.Pretty.prettyExpression
    in
    Pretty.pretty 80 doc


toNodeExpression : Html.Parser.Node -> Maybe Elm.Syntax.Expression.Expression
toNodeExpression node =
    case node of
        Html.Parser.Text str ->
            if String.isEmpty (String.trim str) then
                Nothing

            else
                Just <|
                    Elm.Syntax.Expression.Application
                        (List.map toNode
                            [ Elm.Syntax.Expression.FunctionOrValue [] "text"
                            , Elm.Syntax.Expression.Literal (String.trim str)
                            ]
                        )

        Html.Parser.Element tagName attributes children ->
            Just <|
                Elm.Syntax.Expression.Application
                    (List.map toNode
                        (List.concat
                            [ case findMatch tagName (htmlFunctions ++ svgFunctions) of
                                Just match ->
                                    [ Elm.Syntax.Expression.FunctionOrValue [] match ]

                                Nothing ->
                                    if tagName == "pathmango" then
                                        [ Elm.Syntax.Expression.FunctionOrValue [] "path" ]

                                    else if tagName == "main" || tagName == "text" then
                                        [ Elm.Syntax.Expression.FunctionOrValue [] (tagName ++ "_") ]

                                    else
                                        [ Elm.Syntax.Expression.FunctionOrValue [] "node"
                                        , Elm.Syntax.Expression.Literal tagName
                                        ]
                            , [ List.map toAttributeExpression attributes
                                    |> List.map toNode
                                    |> Elm.Syntax.Expression.ListExpr
                              , List.filterMap toNodeExpression children
                                    |> List.map toNode
                                    |> Elm.Syntax.Expression.ListExpr
                              ]
                            ]
                        )
                    )

        Html.Parser.Comment _ ->
            Nothing


toAttributeExpression : Html.Parser.Attribute -> Elm.Syntax.Expression.Expression
toAttributeExpression ( key, value ) =
    Elm.Syntax.Expression.Application
        (List.map toNode
            (List.concat
                [ case findMatch key (htmlAttributeNames ++ svgAttributeNames) of
                    Just match ->
                        [ Elm.Syntax.Expression.FunctionOrValue [] match ]

                    Nothing ->
                        if key == "in" || key == "type" then
                            [ Elm.Syntax.Expression.FunctionOrValue [] (key ++ "_") ]

                        else
                            [ Elm.Syntax.Expression.FunctionOrValue [] "attribute"
                            , Elm.Syntax.Expression.Literal key
                            ]
                , [ Elm.Syntax.Expression.Literal value ]
                ]
            )
        )


findMatch : String -> List String -> Maybe String
findMatch key items =
    List.head (List.filter (\x -> key == String.toLower x) items)


toNode : value -> Elm.Syntax.Node.Node value
toNode value =
    Elm.Syntax.Node.Node
        Elm.Syntax.Range.emptyRange
        value


htmlFunctions =
    """
a
abbr
address
article
aside
audio
b
bdi
bdo
blockquote
br
button
canvas
caption
cite
code
col
colgroup
datalist
dd
del
details
dfn
div
dl
dt
em
embed
fieldset
figcaption
figure
footer
form
h1
h2
h3
h4
h5
h6
header
hr
i
iframe
img
input
ins
kbd
label
legend
li
mark
math
menu
menuitem
meter
nav
object
ol
optgroup
option
output
p
param
pre
progress
q
rp
rt
ruby
s
samp
section
select
small
source
span
strong
sub
summary
sup
table
tbody
td
textarea
tfoot
th
thead
time
tr
track
u
ul
var
video
wbr
"""
        |> String.trim
        |> String.lines


svgFunctions =
    """
a
altGlyph
altGlyphDef
altGlyphItem
animate
animateColor
animateMotion
animateTransform
circle
clipPath
colorProfile
cursor
defs
desc
ellipse
feBlend
feColorMatrix
feComponentTransfer
feComposite
feConvolveMatrix
feDiffuseLighting
feDisplacementMap
feDistantLight
feFlood
feFuncA
feFuncB
feFuncG
feFuncR
feGaussianBlur
feImage
feMerge
feMergeNode
feMorphology
feOffset
fePointLight
feSpecularLighting
feSpotLight
feTile
feTurbulence
filter
font
foreignObject
g
glyph
glyphRef
image
line
linearGradient
marker
mask
metadata
mpath
path
pattern
polygon
polyline
radialGradient
rect
set
stop
style
svg
switch
symbol
textPath
title
tref
tspan
use
view
""" |> String.trim |> String.lines


svgAttributeNames =
    """
accelerate
accentHeight
accumulate
additive
alignmentBaseline
allowReorder
alphabetic
amplitude
arabicForm
ascent
attributeName
attributeType
autoReverse
azimuth
baseFrequency
baseProfile
baselineShift
bbox
begin
bias
by
calcMode
capHeight
class
clip
clipPath
clipPathUnits
clipRule
color
colorInterpolation
colorInterpolationFilters
colorProfile
colorRendering
contentScriptType
contentStyleType
cursor
cx
cy
d
decelerate
descent
diffuseConstant
direction
display
divisor
dominantBaseline
dur
dx
dy
edgeMode
elevation
enableBackground
end
exponent
externalResourcesRequired
fill
fillOpacity
fillRule
filter
filterRes
filterUnits
floodColor
floodOpacity
fontFamily
fontSize
fontSizeAdjust
fontStretch
fontStyle
fontVariant
fontWeight
format
from
fx
fy
g1
g2
glyphName
glyphOrientationHorizontal
glyphOrientationVertical
glyphRef
gradientTransform
gradientUnits
hanging
height
horizAdvX
horizOriginX
horizOriginY
id
ideographic
imageRendering
in2
in_
intercept
k
k1
k2
k3
k4
kernelMatrix
kernelUnitLength
kerning
keyPoints
keySplines
keyTimes
lang
lengthAdjust
letterSpacing
lightingColor
limitingConeAngle
local
markerEnd
markerHeight
markerMid
markerStart
markerUnits
markerWidth
mask
maskContentUnits
maskUnits
mathematical
max
media
method
min
mode
name
numOctaves
offset
opacity
operator
order
orient
orientation
origin
overflow
overlinePosition
overlineThickness
panose1
path
pathLength
patternContentUnits
patternTransform
patternUnits
pointOrder
pointerEvents
points
pointsAtX
pointsAtY
pointsAtZ
preserveAlpha
preserveAspectRatio
primitiveUnits
r
radius
refX
refY
renderingIntent
repeatCount
repeatDur
requiredExtensions
requiredFeatures
restart
result
rotate
rx
ry
scale
seed
shapeRendering
slope
spacing
specularConstant
specularExponent
speed
spreadMethod
startOffset
stdDeviation
stemh
stemv
stitchTiles
stopColor
stopOpacity
strikethroughPosition
strikethroughThickness
string
stroke
strokeDasharray
strokeDashoffset
strokeLinecap
strokeLinejoin
strokeMiterlimit
strokeOpacity
strokeWidth
style
surfaceScale
systemLanguage
tableValues
target
targetX
targetY
textAnchor
textDecoration
textLength
textRendering
title
to
transform
type_
u1
u2
underlinePosition
underlineThickness
unicode
unicodeBidi
unicodeRange
unitsPerEm
vAlphabetic
vHanging
vIdeographic
vMathematical
values
version
vertAdvY
vertOriginX
vertOriginY
viewBox
viewTarget
visibility
width
widths
wordSpacing
writingMode
x
x1
x2
xChannelSelector
xHeight
xlinkActuate
xlinkArcrole
xlinkHref
xlinkRole
xlinkShow
xlinkTitle
xlinkType
xmlBase
xmlLang
xmlSpace
y
y1
y2
yChannelSelector
z
zoomAndPan
""" |> String.trim |> String.lines


htmlAttributeNames =
    """
accept
acceptCharset
accesskey
action
align
alt
autocomplete
autofocus
autoplay
checked
cite
class
classList
cols
colspan
contenteditable
contextmenu
controls
coords
datetime
default
dir
disabled
download
draggable
dropzone
enctype
for
form
headers
height
hidden
href
hreflang
id
ismap
itemprop
kind
lang
list
loop
manifest
max
maxlength
media
method
min
minlength
multiple
name
novalidate
pattern
ping
placeholder
poster
preload
property
pubdate
readonly
rel
required
reversed
rows
rowspan
sandbox
scope
selected
shape
size
spellcheck
src
srcdoc
srclang
start
step
style
tabindex
target
title
type_
usemap
value
width
wrap
""" |> String.trim |> String.lines
