port module Worker exposing (main)

import Elm.Parser
import Elm.RawFile
import Json.Encode
import Platform


port input : (String -> msg) -> Sub msg


port onSuccess : Json.Encode.Value -> Cmd msg


port onFailure : String -> Cmd msg


type alias Model =
    ()


type Msg
    = GotInput String


main : Program () Model Msg
main =
    Platform.worker
        { init = \() -> ( (), Cmd.none )
        , update = update
        , subscriptions = subscriptions
        }


update : Msg -> Model -> ( Model, Cmd Msg )
update msg model =
    case msg of
        GotInput rawElmSource ->
            ( model
            , case Elm.Parser.parse rawElmSource of
                Ok rawFile ->
                    onSuccess (Elm.RawFile.encode rawFile)

                Err deadEnds ->
                    onFailure "Could not parse Elm file"
            )


subscriptions : Model -> Sub Msg
subscriptions _ =
    input GotInput
