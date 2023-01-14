port module Worker exposing (main)

import Elm.Parser
import Elm.RawFile
import Json.Encode
import Platform


port onSuccess : Json.Encode.Value -> Cmd msg


port onFailure : String -> Cmd msg


main : Program String () ()
main =
    Platform.worker
        { init = init
        , update = \_ model -> ( model, Cmd.none )
        , subscriptions = \_ -> Sub.none
        }


init : String -> ( (), Cmd () )
init rawElmSource =
    ( ()
    , case Elm.Parser.parse rawElmSource of
        Ok rawFile ->
            onSuccess (Elm.RawFile.encode rawFile)

        Err deadEnds ->
            onFailure "Could not parse Elm file"
    )
